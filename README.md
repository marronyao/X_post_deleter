# X Post Deleter

A lightweight Chrome extension that automatically scrolls through your own X timeline and deletes discoverable posts, quote posts, and replies.

**Deletion is permanent.** Download your X archive before starting. Typing `delete` and clicking **Delete all posts** (or pressing Enter) authorizes the entire run, including posts loaded later. There is no preview or additional confirmation prompt.

## Install

1. [Download X Post Deleter v1.2.0](https://github.com/marronyao/X_post_deleter/raw/refs/heads/main/downloads/x-post-deleter-1.2.0.zip) and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**, then click **Load unpacked**.
4. Select the extracted folder containing `manifest.json` and `content.js`.
5. Open X, sign in, and refresh the page. The **X Post Deleter** panel appears at the bottom right.

You can also use **Code → Download ZIP** on this repository, extract it, and select the repository folder containing `manifest.json`. No build step, Python, Node.js, or additional extension permissions are required to install it. Keep the chosen folder in place while the extension is installed.

## Use

1. Open **Replies** on your own profile: `https://x.com/YOUR_USERNAME/with_replies`.
2. Verify the username in the panel. Use your handle without `@`, not your display name. It must match the signed-in account.
3. Set **Delay between posts** if desired. The default is **0 seconds**.
4. Type the exact lowercase word `delete`.
5. Click **Delete all posts**, or press Enter in the confirmation field.
6. Keep the tab in the foreground and let the tool scroll automatically. Do not scroll manually, switch accounts, or use other X menus during the run.
7. Refresh your profile after the run and check the results.

Click **Stop now** or press **Esc** to stop. Moving the tab to the background also stops processing. Stopping cannot undo requests already submitted. If an X confirmation dialog remains open, cancel it manually. **Minimize** only hides the panel; it does not stop the run.

Changing the username or delay clears the confirmation. A stopped or completed run never resumes automatically: check X, type `delete` again, and start another run.

### Delay

| Setting | Behavior |
| --- | --- |
| `0` (default) | No extra wait between posts |
| `0.5` | Adds a fixed half-second wait |
| `12` | Adds a fixed 12-second wait |
| Up to `120` | Adds the specified number of seconds |

There is no random delay. Even at `0`, deletion is sequential: the tool waits for X's menus, confirmation dialogs, and page updates. Loading and scanning also take time. Delays do not bypass X's limits; a detected error or limit stops the run without an automatic deletion retry.

## What it deletes

- Your discoverable original posts, quote posts, and replies in the Replies timeline.
- Pinned posts when their label is recognized.
- Older eligible posts loaded as the tool scrolls.

Ordinary reposts and unrecognized social-context cards are skipped. Use X's **Undo repost** action to remove reposts manually. Likes, direct messages, and other people's posts are not changed. Deleting your quote post or reply does not delete the other person's original post.

The panel is in English. X's **Delete** and **Pinned** labels are recognized in English, Simplified Chinese, and Traditional Chinese. Use one of these X interface languages.

## Limits and completion

The tool works through X's visible web interface. It cannot delete history that X does not expose in the timeline. It does not import an archive, call private APIs, or automatically refresh the page.

Scanning ends after six unchanged bottom checks without a loading indicator. **Finished means the scan ended, not that your entire account history is proven empty.** Refresh and verify; if older posts appear, run the tool again. A submitted deletion request or a post disappearing from the page is not independent proof of final server deletion.

The tool stops on account or page changes, unexpected menus or dialogs, timeouts, detected X errors, or 120 consecutive scroll checks without finding an eligible post. Interface changes can break detection. Automated tests use simulated timelines; they do not perform real-account deletions or establish compatibility with every current X layout.

## Privacy

The extension runs locally on `x.com` and `www.x.com`. It uses the signed-in page's normal controls to submit deletion requests to X. It does not read passwords, directly access cookies, call private APIs, send data to third-party services, or persist account or post data. Logs exist only in the current page.

## Update or uninstall

To update, replace the files in the installed folder (or run `git pull` if you cloned this repository), click **Reload** for the extension at `chrome://extensions`, then refresh all X tabs. There is no need to remove and reinstall when the folder stays the same.

To uninstall, click **Remove** at `chrome://extensions` and refresh all X tabs.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Panel is missing | Reload the extension, refresh X, and confirm the selected folder contains `manifest.json`. |
| Account cannot be identified | Sign in and widen the window so the left navigation's Profile link is available. |
| Start button is disabled | Enter a valid username, a delay from 0 to 120, and exactly `delete`. |
| Tool asks for Replies | Open your own `/with_replies` page before starting. |
| Tool stops unexpectedly | Read the panel log, cancel pending dialogs, and check X before starting again. |
| Older posts remain | Refresh and run again if X loads more history; hidden or unavailable history cannot be reached by this tool. |

## Development

Node.js 22 or newer runs the tests. There are no npm dependencies to install.

```sh
npm test
```

The tests cover confirmation, delay validation, zero-delay behavior, automatic discovery, author filtering, duplicate avoidance, stopping, errors, and run cleanup. They simulate the browser and do not delete real posts.

To rebuild the installation ZIP, use Python 3.9 or newer (standard library only):

```sh
python scripts/package.py
```

The packager includes only the manifest, content script, README, installation guide, and license. It excludes tests, Git metadata, and development files, and uses fixed ZIP timestamps for reproducible output. Rebuild and commit the ZIP whenever its included files change.

```text
content.js                  Extension logic and panel
manifest.json               Chrome Manifest V3 configuration
README.md                   Project and usage documentation
Installation and Usage.txt  Plain-text installation guide
tests/                      Simulated browser tests and package checks
scripts/package.py          Installation ZIP builder
downloads/                  Ready-to-extract installation ZIP
LICENSE                     MIT license
```

### Optional userscript

`content.js` includes userscript metadata. You can paste its full contents into a new Tampermonkey script instead of loading the Chrome extension. Install only one version at a time to avoid conflicts. This distribution is primarily tested as a Chrome extension.

## License

[MIT](LICENSE). This is an independent project and is not affiliated with X or Chrome.

## References

- [Chrome: Load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [X: Delete posts](https://help.x.com/en/using-x/delete-posts)
- [X: Reposts](https://help.x.com/en/using-x/how-to-repost)
- [Tampermonkey FAQ](https://www.tampermonkey.net/faq.php?locale=en)
