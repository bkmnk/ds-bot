import { join } from "path";

import CustomClient from "./utils/types/Client";

import { Config } from "./utils/types/Config";
import { Mirrors } from "./utils/types/Mirrors";
import { brand, logger } from "./utils/functions";

brand(require("../package.json").version);
const client: CustomClient = new CustomClient({
  checkUpdate: false,
});
console.log('client',client)

client.config = new Config(join(__dirname, "../config.yaml"));
console.log('client.config',client.config)
client.mirrors = new Mirrors(client.config);
console.log('client.mirrors',client.mirrors)

client.on("ready", async () => {
  logger(`Espelhos iniciados! Usuário: ${client.user?.username}`);
});

client.on("messageCreate", client.mirrors.onMirror);
client.on("messageUpdate", (old, _new) => client.mirrors?.onMirror(_new, true));
client.on("messageDelete", (msg) => client.mirrors?.onMirror(msg, false, true));

client.login(client.config?.getToken());
