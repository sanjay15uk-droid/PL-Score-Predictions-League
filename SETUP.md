# Premier League Predictor — GitHub Pages setup

## 1. Create the repository
1. Go to github.com → click **+** (top right) → **New repository**
2. Name it something like `pl-predictor-league` (no spaces)
3. Set it to **Public** (required for free GitHub Pages)
4. Click **Create repository**

## 2. Upload the files
1. On your new repo's page, click **Add file → Upload files**
2. Drag in all three files: `index.html`, `data.json`, `.nojekyll`
3. Click **Commit changes**

## 3. Turn on GitHub Pages
1. In your repo, go to **Settings → Pages**
2. Under "Build and deployment", set **Source** to **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)** → **Save**
4. Wait about a minute, then your site will be live at:
   `https://<your-username>.github.io/<repo-name>/`

## 4. Try it
- Open that link — you'll see the app in **View only** mode.
- Tap the pill under the title and enter the PIN **6288** to unlock editing.
- Add fixtures, enter predictions, toggle chips as normal.

## 5. Publish your changes live
Editing only changes what's in your browser tab until you publish it. In the Gameweek tab (editor mode), there's a **Publish live** button. The first time you use it, it'll ask for a **GitHub personal access token**:

1. Go to github.com → click your profile photo → **Settings**
2. **Developer settings** (bottom of the left sidebar) → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
3. Give it a name, set **Repository access** to "Only select repositories" → choose your repo
4. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**
5. Generate the token and copy it (you won't see it again)
6. Paste it into the prompt when you tap "Publish live" in the app

The token is saved only in your own browser (localStorage on your device) so you won't need to re-enter it each time on that device. Don't share this token with anyone — whoever has it can edit the live data.

If "Publish live" ever fails (e.g. token expired), the app shows a **manual fallback**: it displays the full updated data as text you can copy and paste directly into `data.json` on GitHub (open the file on github.com → pencil icon to edit → select all → paste → Commit changes). That always works as a backup.

## Notes
- Anyone with the site link can **view** live results — no login needed.
- Only whoever holds the GitHub token (or has repo write access) can **edit and publish**.
- Changes usually appear live within a few seconds to a minute after publishing.
