#!/usr/bin/env node
import process from "node:process";
import { runCli } from "./cli.js";

await runCli(process.argv);
