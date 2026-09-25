# Image File Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local HTML app that encrypts files up to 10 MiB into either a new PNG or a user-supplied cover image and restores them later.

**Architecture:** `vault-core.js` owns the encrypted binary packet; `image-codec.js` maps that packet to pixels in two reversible ways; `app.js` handles browser files, canvas and downloads. `index.html` and `styles.css` provide one local page. Scripts use browser globals and CommonJS exports so Node's built-in test runner can test the binary logic without dependencies.

**Tech Stack:** HTML, CSS, JavaScript, Web Crypto, Canvas, File API, Node `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-09-25-image-file-vault-design.md`

## Global Constraints

- No server or external libraries; page must work from a local folder in modern browsers.
- Source file maximum: 10 MiB (10 × 1024 × 1024 bytes).
- PBKDF2-SHA-256 with 310,000 iterations, random 16-byte salt; AES-GCM-256 with random 12-byte IV and 128-bit tag.
- Names and MIME types are inside ciphertext. Never persist the password or file data in browser storage.
- Both output modes produce PNG. Cover image dimensions stay fixed; transparent covers are flattened on white before embedding.
- Extraction accepts only PNGs produced by this app; do not silently resize or re-encode the input.

## Review Focus

- Empty source file must round-trip with its name intact: Task 1 test.
- Unicode filename and MIME type must round-trip without byte-length errors: Task 1 test.
- A tampered declared payload length must be rejected before allocating or reading past the image: Task 2 test.
- Transparent carrier pixels must become opaque while retaining the visible composition on white: Task 3 browser check.
- A non-PNG input must show an actionable error before extraction: Task 3 browser check.

---

### Task 1: Encrypted file packet

**Files:**
- Create: `vault-core.js`
- Create: `tests/vault-core.test.js`

**Interfaces:**
- Produces: `VaultCore.estimatePacketLength(fileSize, name, mimeType) -> number`; `VaultCore.encryptFile({name, type, bytes}, password) -> Promise<Uint8Array>`; `VaultCore.decryptFile(packet, password) -> Promise<{name, type, bytes}>`.
- Packet: 4-byte `FVLT` magic, 1-byte version `1`, 4-byte big-endian ciphertext length, 16-byte salt, 12-byte IV, ciphertext. Plaintext: 2-byte name length, 2-byte MIME length, 4-byte file length, then UTF-8 name, MIME and file bytes. AES-GCM tag adds 16 bytes.

- [ ] **Step 1: Write failing tests** in `tests/vault-core.test.js` for exact estimate, byte/name/type round-trip, empty file, Unicode name, wrong password, malformed packet and source >10 MiB.
- [ ] **Step 2: Run** `node --test tests/vault-core.test.js`; confirm failures from missing module/exports.
- [ ] **Step 3: Implement** the three interface functions in `vault-core.js`, using `globalThis.crypto` in browser and `require('node:crypto').webcrypto` in Node; reject blank passwords and oversized files.
- [ ] **Step 4: Run** `node --test tests/vault-core.test.js`; expect all tests to pass.
- [ ] **Step 5: Commit** `vault-core.js` and its tests with message `feat: add encrypted file packet`.

### Task 2: Reversible PNG pixel formats

**Files:**
- Create: `image-codec.js`
- Create: `tests/image-codec.test.js`

**Interfaces:**
- Consumes: packet bytes from `VaultCore.encryptFile`.
- Produces: `ImageCodec.coverCapacity(width, height) -> number` (maximum packet bytes); `ImageCodec.encodeData(packet) -> {width, height, pixels: Uint8ClampedArray}`; `ImageCodec.encodeStego(packet, pixels, width, height) -> Uint8ClampedArray`; `ImageCodec.decode(pixels, width, height) -> {mode: 'data'|'stego', packet: Uint8Array}`.
- Each pixel payload starts with an 8-byte header: four ASCII bytes `VDAT` or `VSTG`, then 4-byte big-endian packet length. Data mode uses the RGB bytes directly; stego uses one least-significant bit from each RGB channel. Alpha is always 255 in returned output.

- [ ] **Step 1: Write failing tests** for both pixel round-trips, capacity boundary, a tiny insufficient cover, preserved dimensions and non-hidden RGB bits, invalid magic, and declared length larger than available pixels.
- [ ] **Step 2: Run** `node --test tests/image-codec.test.js`; confirm failures from missing module/exports.
- [ ] **Step 3: Implement** the four interface functions in `image-codec.js`. Reject zero dimensions, absurd dimensions above Canvas limits (16,384 per side or 100 million pixels), and packet lengths above available capacity before allocation.
- [ ] **Step 4: Run** `node --test tests/image-codec.test.js`; expect all tests to pass.
- [ ] **Step 5: Commit** codec and tests with message `feat: encode encrypted packets in PNG pixels`.

### Task 3: Local browser app

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `app.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `VaultCore` and `ImageCodec` globals from Tasks 1 and 2.
- Produces: three UI actions (hide, data PNG, extract), PNG/file downloads and actionable status/error text.

- [ ] **Step 1: Build a browser checklist** covering both complete round-trips, downloaded PNG re-import, wrong password, over-capacity cover, transparent cover, empty file, non-PNG input and missing browser APIs; record it in `README.md`.
- [ ] **Step 2: Create** `index.html` with three accessible modes and file/password inputs; load local scripts in dependency order. Add responsive styling in `styles.css`.
- [ ] **Step 3: Implement** `app.js`: validate inputs; decode cover or input PNG without rescaling; flatten transparent covers on white; call core/codec; use Canvas `toBlob('image/png')` and object URLs for downloads; revoke old URLs and keep processing state clear.
- [ ] **Step 4: Run** `node --test tests/*.test.js`; expect all tests to pass. Open `index.html` in a browser and complete the README checklist with downloaded files, checking byte equality and original names.
- [ ] **Step 5: Commit** UI and README with message `feat: add local image vault app`.

### Task 4: Final verification

**Files:**
- Modify: `README.md` only if verification reveals a missing usage constraint.

**Interfaces:**
- Consumes: completed app and tests.
- Produces: a verified release state for the local folder.

- [ ] **Step 1: Run** `node --test tests/*.test.js`; expect all tests to pass.
- [ ] **Step 2: Repeat** browser download/re-import for both modes with a binary sample and verify byte equality; check the 10 MiB limit and wrong password.
- [ ] **Step 3: Run** `git status --short` and inspect the diff for uncommitted or unrelated changes; commit any verification-driven README correction.
