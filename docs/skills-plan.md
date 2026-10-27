# Skills plan

A **skill** is a reusable set of instructions a user can tag onto a chat message, such as "write in our release-notes style" or "review code against our checklist". Skills use the same file format as Anthropic Agent Skills (`SKILL.md`: YAML frontmatter with `name` and `description`, then Markdown instructions), so skills written for Claude can be imported and ChatterStack skills can be exported.

This plan covers four pieces of work: the skill model and API, the skill creator, importing and exporting, and tagging skills in the composer.

## 1. Data model

New Prisma model `Skill`, owned by a user:

| Field | Notes |
| --- | --- |
| `id` | uuid |
| `userId` | cascade delete with the user |
| `name` | kebab-case slug, 1–64 chars, unique per user. This is what the user types after `/`. |
| `description` | 1–1024 chars. Says when to use the skill; shown in the picker. |
| `instructions` | Markdown body, up to 8,000 characters. Kept short because skill text counts toward the 4,000-token daily limit. |
| `source` | `created`, `generated` (skill creator), or `imported` |
| `createdAt`, `updatedAt` | |

`Message` gets an optional `skills Json?` column holding `[{ id, name }]` for the skills tagged on a user message. Only the reference is stored, so later edits to a skill do not rewrite history. A deleted skill shows as removed, the same way deleted documents do.

Limits: 50 skills per user and 3 skills per message.

## 2. Skill file format (`src/lib/skills/skill-file.ts`)

This module has no dependencies, so the client and the server both use it.

- `parseSkillFile(text)` reads frontmatter (`name`, `description`, including quoted and `>`/`|` block values) and returns `{ name, description, instructions }`. Other frontmatter keys such as `license` and `allowed-tools` are ignored. When there is no frontmatter, it falls back to the first `# Heading` for the name.
- `serializeSkill(skill)` writes a valid `SKILL.md`.
- `normalizeSkillName(text)` turns arbitrary text into a valid slug.
- The validation rules are a shared zod schema (`SkillInputSchema`) used by the API routes and the editor.

## 3. API

| Route | Purpose |
| --- | --- |
| `GET /api/skills` | List the user's skills (metadata and instructions). |
| `POST /api/skills` | Create a skill from `{ name, description, instructions, source }`. Returns 409 on a duplicate name. |
| `GET/PATCH/DELETE /api/skills/[id]` | Read, update, or delete one skill. |
| `GET /api/skills/[id]/export` | Download the skill as `SKILL.md`. |
| `POST /api/skills/import` | Parse `SKILL.md` text and return a validated draft without saving it. The client opens the draft in the editor for review. |
| `POST /api/skills/generate` | The skill creator: turn a plain-language request into a draft `SKILL.md` using a chat model. Rate-limited like chat. Returns a draft without saving it. |

Every route requires a session and only touches the user's own rows.

## 4. Chat integration

- `ChatRequestSchema` gains `skills: uuid[]` (max 3). The route loads the user's skills by id and returns 400 if any is missing.
- Skill instructions go into the system context for that turn only, as a `## Active skills` section after the system prompt. Single-model chats get it through `createCompletion`; in council mode, the members (stage 1) and the chair (stage 3) both receive it.
- The skill text is included in the rate-limit check and the token count.
- The user message is saved with its `skills` tags, and `conversations.ts` returns them so the tags show after a reload.
- Skills apply to the turn they are tagged on. They do not stay active for the rest of the conversation. This keeps the behaviour predictable and token use bounded. A "keep active" toggle can come later.

## 5. UI

### Sidebar: Skills tab
A third tab next to Chats and Resources lists the user's skills: name, description, source badge, and the actions **Use**, **Edit**, **Export**, and **Delete**. The header has **New skill** and **Import** buttons.

### Skill editor (modal)
- Fields: name, description, and instructions, with live validation and character counts.
- **Skill creator** section: "Describe the skill you want", then **Draft with AI**. This calls `/api/skills/generate` and fills in the fields. The user reviews and edits the draft before saving.

### Import (modal)
Choose a `.md` file (for example a `SKILL.md`) or paste its text. The text is parsed, and the editor opens prefilled with `source: imported`. If the name already exists, the editor shows the conflict so the user can rename the skill.

### Tagging in the composer
- Typing `/` at the start of a word opens a skill picker above the composer. The picker filters as you type and supports ↑/↓, Enter/Tab to pick, and Esc to close. Picking a skill removes the `/query` text and adds a skill chip next to the file chips.
- A **Skills** button beside the paperclip opens the same picker.
- The sidebar's **Use** action adds a skill chip through a `chatterstack:add-skill` window event, the same way Resources adds a document.
- Sent user messages show their skill chips.

## 6. Delivery steps (one commit each)

1. Plan document (this file).
2. Prisma model, skill-file module and unit tests.
3. Skills API routes and integration tests.
4. Chat route integration (schema, prompt injection, council, persistence) and tests.
5. Sidebar Skills tab, editor, skill creator, and import/export UI.
6. Composer tagging (`/` picker, chips, message display) and component tests.
7. e2e spec and README section. The pull request into `dev` is opened after the feature has been reviewed.

## Out of scope for now

- Zip skill bundles with extra files (scripts, references). Only the `SKILL.md` text is imported. Files referenced from it are not.
- Importing from a URL (this needs SSRF protection and is a separate change).
- Shared or public skill libraries, and automatic skill selection by the model.

## Revision 2: match claude.ai one-to-one

After reviewing claude.ai (Customize → Skills) side by side, the UI is rebuilt to follow it.

### Navigation
- The sidebar uses vertical rows instead of tabs: **New chat**, **Search**, **Resources**, **Customize**, then the **Pinned** and **Recents** chat sections ("Chats" becomes "Recents").
- Resources and Customize open pages in the main area (`/resources`, `/customize/skills/...`), like Projects and Artifacts in Claude.

### Customize → Skills
- The page has a **Customize** header, a **Skills** tab, a **Yours / Discover** switch, search, and an **Add skill** menu with **Upload skill**, **Create a skill**, and **Create with AI**.
- **Yours** has two sections, "Created by you" and "From ChatterStack" (skills added from Discover). Rows show the icon, name, categories (+n), "by you · description", the date, a **Turn on/off** toggle, and a ⋯ menu: Try in chat, Edit with AI, Replace, Duplicate, Download, Remove.
- **Discover** suggests built-in skills (catalog in code) in cards with **Try** and **+ Add**, and can filter by category.
- **Skill page** (`/customize/skills/<id>`): a "Your skills" breadcrumb, "by you · v{n} · updated {date}", an on/off switch, and the ⋯ menu. The **Overview** tab shows the description, categories, and creator. The **Contents** tab shows a file list, the rendered SKILL.md with its frontmatter, and **Edit**.
- **Create a skill** (dialog): name, description, and a file tree with SKILL.md plus **Add file** (`path/to/file.md`). There is an editor per file, and **Cancel**/**Create**.
- **Upload skill** (page): drag and drop or browse, several files at once. Accepts `.md` (YAML frontmatter with name and description), and `.zip` or `.skill` (must contain a SKILL.md, either at the root or in one top folder). Checks run on upload: SKILL.md present and valid, safe relative paths, size and file-count limits, text files only (binaries are skipped and reported), and a warning that scripts are stored but never executed.
- **Create with AI**: opens a new chat with the composer prefilled with "Let's create a skill together using /skill-creator. First ask me what the skill should do." The built-in skill-creator is added automatically. When an answer contains a SKILL.md code block, it gets a **Save as skill** button that opens the create dialog prefilled.
- **Download** returns `<name>.zip` (`<name>/SKILL.md` plus files), which Claude's upload accepts.

### Chat
- `/` opens one menu that combines **Add files** with the user's **enabled** skills. Picking a skill inserts an inline, highlighted `/name` token into the message text (no chip row). Up to three skill tokens in a message apply. Sent messages highlight their skill tokens.

### Data
- `Skill` gains `enabled`, `categories`, `files` (text files `[{ path, content }]`), `metadata` (other frontmatter keys, kept on export), `version`, and `catalogId`. Source values are created, generated, uploaded, and catalog.
- Only the SKILL.md body is sent to the model. Bundled files are listed by path, because ChatterStack models can't read files on demand or run scripts.

### Not matched (deliberate)
- Claude can invoke skills automatically from their descriptions. ChatterStack has no tool calling, so skills run only when tagged with `/`.
- The Connectors and Plugins tabs, the Filter and Sort menus, and install counts.
- Claude's server-side security scan. ChatterStack runs the structural checks listed above.
