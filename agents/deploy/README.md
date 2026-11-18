# Deploying the service to Fly.io

Scripts that put the agent service on Fly.io and operate it. There are two Fly apps, and they share nothing:

- **The judging service** (`mind-palace-judging`, `../fly.toml`, `../Dockerfile`): one always-on machine in San Jose with a 5 GB volume. Each headset that joins gets its own space. What it does and its limits are in [../README.md](../README.md), Hosted for judging.
- **The walkthrough demo** (`mind-palace-walkthrough`, `../fly.demo.toml`, `../Dockerfile.demo`): the scripted walkthrough for recording the film, with no volume. See [../demo/README.md](../demo/README.md), On Fly, without the Mac.

Run every script from `agents/`, logged in to Fly. `FLY_APP` names another app when the default name is taken, and `FLY` names the flyctl binary.

## The judging service

| Step | Command | What it does |
|---|---|---|
| Starter trees | `npm run starter -- --from <copy of a data folder>` | Writes `starter/`, which every new space begins as a copy of. The image is built with it, and it is not in git |
| First deploy | `deploy/setup.sh` | Makes the app, its volume and its addresses, sends the secrets, then deploys |
| Secrets | `deploy/secrets.sh` | Sends the keys from this machine's env file to Fly through a pipe. Nothing is printed or written to a file. The Instagram account is never sent |
| Deploy | `deploy/deploy.sh` | Typechecks, runs the hosted test, deploys on Fly's remote builder, and checks health. The volume stays, and so does every headset's space |
| Testing mode | `deploy/deploy.sh testing` | Deploys with the per-headset daily limits off, taking `testing.env` over `fly.toml` for that release only |
| Judging mode | `deploy/deploy.sh judging` | Deploys with `fly.toml`'s limits again. This is the default |
| Status | `deploy/admin.sh status` | Each headset, the day's spend and use, the mode and every limit, and recent errors |
| Off and on | `deploy/admin.sh off`, `deploy/admin.sh on` | Stops all costly work at once, and starts it again. Trees stay browsable while it is off |
| Delete a space | `deploy/admin.sh delete <device id>` | Deletes one headset's space and its folder |
| Roll back | `deploy/rollback.sh`, then `deploy/rollback.sh <image>` | Lists the releases, then runs an earlier image again |
| Back up | `deploy/backup.sh` | A volume snapshot on Fly, and a copy of `/data` in `~/.mind-palace/backups` |
| Instagram library | `deploy/instagram.sh` | Copies the list of accounts and the library a Mac's service has read onto the volume, then restarts the machine |

The limits that stay on in both modes: storage and file sizes, the free-space guard on the volume, public addresses only for fetched pages, the number of headsets, the daily token budget, the spend alerts and the off switch.

## The walkthrough demo

| Command | What it does |
|---|---|
| `deploy/demo.sh setup` | The first time: makes the app and its addresses, then deploys |
| `deploy/demo.sh` | Deploys again after a change to the code, the script or the trees |

The demo's own address and key are written to `~/.mind-palace/demo.properties`. The demo's pictures are in Git LFS, so deploy from a checkout that has run `git lfs pull`.

## What the scripts read from outside the repository

No key, token or address is in git. The scripts read them from files on the machine that deploys, and print none of them:

- the env file the service loads its keys from (`MIND_PALACE_ENV`, by default in the home folder);
- `~/.mind-palace/admin-token`, for `admin.sh`;
- `~/.mind-palace/demo.properties`, written by `demo.sh`.

`secrets.ts` and `demo-secrets.ts` choose which keys go to each app. The demo gets none of the Telegram ones.
