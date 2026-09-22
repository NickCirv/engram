# Read interception demonstration

`demo/run.ts` compares a source search/read path with Engram interception on the checked-out repository. It invokes `rg --line-number --no-heading --sort=path` over `src` and uses graph context to illustrate a narrower response.

```bash
npm install
npm run build
npm run demo
```

The manifest requires Node.js 20 or later. `rg` must also be available. Inspect the script's setup and output paths before running; package installation may run lifecycle scripts. These commands were not executed for this review.

Use the demonstration to inspect the shape of returned context and check it against the original source. Its token estimates do not measure whether an agent completed a task correctly, and are not a billing comparison. Keep the repository revision and exact task with any captured output.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [demo/run.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/demo/run.ts)
- [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json)
