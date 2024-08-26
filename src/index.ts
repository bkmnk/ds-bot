import { join } from "path";

import CustomClient from "./utils/types/Client";

import { Config } from "./utils/types/Config";
import { Mirrors } from "./utils/types/Mirrors";
import { brand, logger } from "./utils/functions";

brand(require("../package.json").version);
const client: CustomClient = new CustomClient({
  checkUpdate: false,
});

client.config = new Config(join(__dirname, "../config.yaml"));
client.mirrors = new Mirrors(client.config);

client.on("ready", async () => {
  logger(`Espelhos iniciados! Usuário: ${client.user?.username}`);
});

client.on("messageCreate", client.mirrors.onMirror);
client.on("messageUpdate", (old, _new) => client.mirrors?.onMirror(_new, true));
client.on("messageDelete", (msg) => client.mirrors?.onMirror(msg, false, true));

client.login(client.config?.getToken());
