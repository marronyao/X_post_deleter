# X Post Deleter

A Chrome extension that detects your signed-in X account and deletes discoverable posts, quote posts, and replies in a separate background tab. Start from your own Posts or Replies page, then keep browsing elsewhere.

**Deletion is permanent.** Download your X archive before starting. Typing `delete` and clicking **Delete all posts** (or pressing Enter) authorizes the entire run, including posts loaded later. There is no preview or additional confirmation prompt.

## Install

1. [Download X Post Deleter v1.3.1](https://github.com/marronyao/X_post_deleter/raw/refs/heads/main/downloads/x-post-deleter-1.3.1.zip) and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**, then click **Load unpacked**.
4. Select the extracted folder containing `manifest.json`, `content.js`, and `background.js`.
5. Open X, sign in, and refresh the page. The **X Post Deleter** panel appears at the bottom right.

You can also use **Code → Download ZIP** on this repository, extract it, and select the repository folder containing `manifest.json`. Chrome 102 or newer is required. No build step, Python, or Node.js is needed to install it. The extension requests the `storage` permission to coordinate the background run. Keep the chosen folder in place while the extension is installed.

## Use

1. Sign in to X and open **Posts**, **All**, or **Replies** on your own profile.
2. The extension detects your account automatically; there is no username field.
3. Set **Delay between posts** if desired. The default is **0 seconds**.
4. Type the exact lowercase word `delete`.
5. Click **Delete all posts**, or press Enter in the confirmation field.
6. The extension opens an inactive X tab and scans both **Posts/All** and **Replies**. Current `/USERNAME/all` profile URLs are supported.
7. You can switch tabs, navigate away from the starting page, or close the starting tab. Keep Chrome and the separate deletion tab open. Do not scroll, navigate, refresh, or use menus in the deletion tab, and do not switch X accounts during the run.
8. When the run ends, refresh your profile and check the results. The deletion tab stays open for inspection.

Click **Stop now** in the original panel or the deletion tab's panel to stop. You can also press **Esc** while either X panel's tab is focused. Stopping cannot undo requests already submitted. If an X confirmation dialog remains open, cancel it manually. **Minimize** only hides the panel; it does not stop the run.

Changing the delay clears the confirmation. An interrupted or completed run never resumes automatically: check X, type `delete` again, and start another run. Only one deletion run can be active at a time.

### Background operation

The starting page is a controller; deletion takes place in a separate inactive tab. This keeps the run independent of navigation in your original tab. The account is checked again in the deletion tab before deletion and during the run.

Hidden tabs may run more slowly because Chrome throttles their timers. The extension makes a best-effort request to prevent automatic tab discard, but cannot guarantee continued execution during browser shutdown, computer sleep, or browser-enforced suspension. Manually closing, refreshing, or navigating the deletion tab stops the run; it does not silently resume. The tool may reload or change its own timeline as an authorized verification step. Keep that tab open and untouched until finished.

### Delay

| Setting | Behavior |
| --- | --- |
| `0` (default) | No extra wait between posts |
| `0.5` | Adds a fixed half-second wait |
| `12` | Adds a fixed 12-second wait |
| Up to `120` | Adds the specified number of seconds |

There is no random delay. Even at `0`, deletion is sequential: the tool waits for X's menus, confirmation dialogs, and page updates. Loading and scanning also take time. Delays do not bypass X's limits; a detected error or limit stops the run without an automatic deletion retry.

## What it deletes

- Your discoverable original posts, quote posts, and replies across Posts/All and Replies.
- Your pinned posts, including when the surrounding social label changes.
- Older eligible posts loaded as the tool scrolls.

Recognizable ordinary reposts are skipped. Other social labels no longer automatically exclude your posts. Use X's **Undo repost** action to remove reposts manually. Likes, direct messages, and other people's posts are not changed. Deleting your quote post or reply does not delete the other person's original post.

The panel is in English. X's **Delete**, **More**, and repost labels are recognized in English, Simplified Chinese, and Traditional Chinese. Use one of these X interface languages.

## Limits and completion

The tool works through X's visible web interface. It cannot delete history that X does not expose in the timeline. It does not import an archive or call private APIs. Fresh-page verification uses controlled reloads within the authorized deletion tab.

Six unchanged bottom checks end only the current timeline pass, not the job. The tool reloads fresh pages and alternates Posts/All with Replies. It also reloads after each 25 deletions to reduce gaps caused by X unloading or rearranging cards.

Completion requires **four consecutive fresh passes without additional deletions**, covering both timelines twice. Any new deletion resets this verification. A recognizable own post that cannot be parsed, a missing menu, or an unrecognized blank timeline stops with a diagnostic instead of silently declaring completion.

**Finished still cannot prove that account history unavailable through X's interface is empty.** Refresh and verify; if older posts appear, run the tool again. A submitted deletion request or a post disappearing from the page is not independent proof of final server deletion.

The tool stops on account changes, unexpected deletion-tab navigation, unexpected menus or dialogs, timeouts, detected X errors, or 120 consecutive scroll checks without finding an eligible post. Interface changes can break detection. Automated tests use simulated timelines; they do not perform real-account deletions or establish compatibility with every current X layout.

## Privacy

The extension runs on `x.com` and `www.x.com`. It uses the signed-in page's normal controls to submit deletion requests to X. It does not read passwords, directly access cookies, call private APIs, or send data to third-party services.

The `storage` permission is used for Chrome's in-memory `storage.session` area. It holds the current job's account handle, delay, tab IDs, status, deletion count, verification-pass state, and latest progress message (which can include a post ID or X error). Full page logs stay in their respective tabs. No post bodies or history archive are saved. Session state is not synced and is cleared when Chrome restarts or the extension reloads. No browsing-history, cookies, debugger, or broad host-access permission is requested.

## Update or uninstall

To update, replace the files in the installed folder (or run `git pull` if you cloned this repository), click **Reload** for the extension at `chrome://extensions`, then refresh all X tabs. There is no need to remove and reinstall when the folder stays the same.

To uninstall, click **Remove** at `chrome://extensions` and refresh all X tabs.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Panel is missing | Reload the extension, refresh X, and confirm the selected folder contains `manifest.json` and `background.js`. |
| Account cannot be identified | Sign in and widen the window so the left navigation's Profile link is available. |
| Start button is disabled | Enter a delay from 0 to 120 and exactly `delete`. |
| Tool asks for your profile | Open your own Posts/All or Replies page. Other profiles and the Home feed cannot start a run. |
| Background run is slow | Chrome can throttle hidden tabs. Open the deletion tab to inspect progress without interacting with its timeline. |
| Tool stops unexpectedly | Read the panel log, cancel pending dialogs, and check X before starting again. |
| Older posts remain | Refresh and run again if X loads more history; hidden or unavailable history cannot be reached by this tool. |

## Development

Node.js 22 or newer runs the tests. There are no npm dependencies to install.

```sh
npm test
```

The tests cover confirmation, account detection, Posts/Replies entry, background coordination, tab lifecycle, fresh-page verification, modern profile paths and DOM fallbacks, delay validation, automatic discovery, author filtering, duplicate avoidance, stopping, errors, and run cleanup. They simulate the browser and do not delete real posts.

To rebuild the installation ZIP, use Python 3.9 or newer (standard library only):

```sh
python scripts/package.py
```

The packager includes only the manifest, content script, background service worker, README, installation guide, and license. It excludes tests, Git metadata, and development files, and uses fixed ZIP timestamps for reproducible output. Rebuild and commit the ZIP whenever its included files change.

```text
content.js                  Panel, account detection, and deletion logic
background.js               Background tab coordination and session state
manifest.json               Chrome Manifest V3 configuration
README.md                   Project and usage documentation
Installation and Usage.txt  Plain-text installation guide
tests/                      Simulated browser tests and package checks
scripts/package.py          Installation ZIP builder
downloads/                  Ready-to-extract installation ZIP
LICENSE                     MIT license
```

This version requires the Chrome extension runtime and cannot run as a standalone Tampermonkey userscript.

## License

[MIT](LICENSE). This is an independent project and is not affiliated with X or Chrome.

## References

- [Chrome: Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome: Load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [X: Delete posts](https://help.x.com/en/using-x/delete-posts)
- [X: Reposts](https://help.x.com/en/using-x/how-to-repost)
