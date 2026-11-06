// Exclusive loopback launcher. Does not read keys, enable flags or contact providers.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
const require=createRequire(import.meta.url);
const port=process.env.AIVRA_LOCAL_PORT??"3000";
if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw Error("Invalid local port");
const child=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port",port],{stdio:"inherit",windowsHide:true,env:{...process.env,AIVRA_LOCAL_ALA_PORT:port,AIVRA_LOCAL_ALA_LAUNCHER:randomBytes(32).toString("hex")}});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>process.exit(code??1));
