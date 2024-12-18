import { Denops } from "jsr:@denops/std@7.4.0";
import * as autocmd from "jsr:@denops/std@7.4.0/autocmd";
import * as fn from "jsr:@denops/std@7.4.0/function";
import { assert, is } from "jsr:@core/unknownutil@4.3.0";
import * as Y from "npm:yjs@^13.5.0";
import { WebsocketProvider } from "npm:y-websocket@^1.4.4";

type State = {
  roomName?: string;
  provider?: WebsocketProvider;
  appling: boolean;
  texts: Y.Text[];
};

type Position = [
  number, // bufnum
  number, // lnum
  number, // col
  number, // off
];

export async function main(denops: Denops): Promise<void> {
  const commands = [
    `command! -nargs=1 LiveShareSessionStart call denops#notify("${denops.name}", "sessionStart", [<f-args>])`,
    `command! LiveShareSessionLeave call denops#notify("${denops.name}", "sessionLeave", [])`,
  ];
  for (const cmd of commands) {
    await denops.cmd(cmd);
  }

  const state: State = {
    texts: [],
  };

  denops.dispatcher = {
    async textUpdate(newpos: unknown) {
      assert(newpos, is.ArrayOf(is.Number));
      // TODO: 差分を適用
      const lines = await fn.getline(denops, 1, "$");
      const contents = lines.join("\n");

      console.log("textUpdate", contents);

      for (const text of state.texts) {
        text.doc?.transact(() => {
          console.log("transact");
          text.delete(0, text.length);
          text.insert(0, contents);
        });
      }
    },
    sessionStart(roomName: unknown) {
      assert(roomName, is.String);
      state.roomName = roomName;

      const doc = new Y.Doc();
      const ytext = doc.getText("empty");

      const provider = new WebsocketProvider(
        "ws://localhost:8000",
        state.roomName,
        doc,
        {
          disableBc: true,
        },
      );

      state.texts.push(ytext);

      autocmd.group(denops, "live-share", (helper) => {
        helper.remove("*");
        helper.define(
          ["TextChanged", "TextChangedI"],
          "*",
          `call denops#notify("${denops.name}", "textUpdate", [getcharpos('.')])`,
        );
      });

      doc.on("update", async (_, origin) => {
        if (origin instanceof WebsocketProvider) {
          console.log("update")
          const ytext = origin.doc.share.get("empty");
          if (ytext) {
            const current = await fn.getline(denops, 1, "$");
            if (ytext.toString() === current.join("\n")) {
              return;
            }
            await denops.cmd("silent %d_");
            await fn.setline(denops, 1, ytext.toString().split("\n"));
          }
        }
      });

      state.provider = provider;

      console.log("session started");
    },
    sessionLeave() {
      state.provider?.disconnect();
      state.provider = undefined;
      autocmd.remove(denops, "live-share");
    },
  };
}
