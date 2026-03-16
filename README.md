# PartDB – Desktop Inventory Management System

_A Supabase-powered Electron Application for Managing Parts, Images, and Activity Logs_ for shop floor parts

---

## 📌 Overview

PartDB is a cross-platform desktop application designed for fast, offline-friendly part lookup and secure part management. It leverages:

- **Electron** for the desktop runtime
- **React (Vite)** for the UI
- **Express.js** packaged with `pkg`
- **Supabase** for database and image storage
- **PIN-based access control** for sensitive operations

The packaged product runs as a **single portable .exe** with a fully embedded backend.

---

## ✨ Features

### 🔍 Part Search

- Fast, optimized search
- Pagination and partial matching
- Detailed part view panel

### 🖼️ Image Uploading

- Upload PNG/JPG images to Supabase Storage (`part-images`)
- Replace images when editing parts
- Full integration with backend API

### ➕ Add, Edit, Delete Parts

- PIN-protected sensitive actions
- Backend endpoints:
  - `POST /parts`
  - `PUT /parts/:id`
  - `DELETE /parts/:id`
- All changes stored securely via Supabase

### 📝 Activity Logs

- Logs add/edit/delete actions
- PIN-protected access
- Clean, structured recordkeeping

### 🚀 Single Executable Deployment

- Express backend compiled using **pkg**
- Electron loads backend automatically
- Runs entirely offline
- No Node.js required on client machines

---

## 🛠️ Tech Stack

| Layer     | Technology                            |
| --------- | ------------------------------------- |
| Frontend  | React (Vite), JSX, Tailwind CSS       |
| Backend   | Express.js (Node) compiled with `pkg` |
| Database  | Supabase PostgreSQL                   |
| Storage   | Supabase Storage (`part-images`)      |
| Desktop   | Electron                              |
| Packaging | `electron-builder`, `pkg`             |

---

## 📁 Project Structure

partdb/
│
├── app/
│ ├── src/
│ ├── assets/
│ └── main.js # Electron main process
│
├── server/
│ ├── index.js
│ ├── env.production
│ └── package.json
│
├── dist/ # Packaged application output
│
└── README.md

---

## ⚙️ Development Setup

### Backend

```bash
cd server
node index.js
Frontend
cd client
npm run dev
```

```Electron (Dev Mode)
npm run electron:dev
```

```📦 Packaging the Application
1. Build Backend with pkg
cd server
pkg index.js --targets node16-win-x64 --output partdb-backend.exe

2. Package Electron App
cd app
npm run build
npm run electron:build


Produces a fully self-contained .exe.
```

```🔐 Environment Variables

env.production (loaded automatically in packaged mode):

SUPABASE_URL=(your supabase URL)
SUPABASE_SERVICE_ROLE_KEY=(your supabase Service Role Key)
SUPABASE_ANON_KEY=(your supabase anon key)
NODE_TLS_REJECT_UNAUTHORIZED=0
```

```🗄️ Supabase Schema
Key Tables

parts

activity_logs

Important columns in parts:
Column	Type	Description
id	bigint	Primary key
part_number	text	Identifier for search
description	text	Part details
quantity	integer	Stock count
image_url	text	Supabase Storage path
Storage Bucket

part-images
```

```🔒 Access Control & RLS

RLS enabled for secure data handling

Read access allowed by policy

Writes restricted to backend (service role key)

All sensitive UI actions require a PIN
```

```🐞 Troubleshooting
Search failing

Ensure backend runs on http://127.0.0.1:3002

Confirm correct API base in frontend

"Failed to add part"

Ensure image_url column exists

Confirm bucket name: part-images

Check backend logs for Supabase errors
```

```#📄 License – ABB Internal Use Only

Copyright © 2025 ABB.
All rights reserved.

This software is provided solely for internal use within ABB.

Viewing, running, and modifying the software is permitted exclusively for ABB business purposes.

Use, deployment, distribution, or disclosure outside ABB is strictly prohibited.

The source code may be viewed internally but may not be copied, shared, or published externally without written ABB authorization.

All copies and derivative works must retain this notice.

This is not an open-source license.

────────────────────────────────────────────────────────────
ABB – INTERNAL USE ONLY – CONFIDENTIAL SOFTWARE
────────────────────────────────────────────────────────────

This software and its source code are the confidential and
proprietary property of ABB. It is provided solely for internal
ABB business purposes.

Unauthorized use, copying, distribution, publication, or
disclosure outside of ABB is strictly prohibited.

Internal viewing and modification are allowed only for
legitimate ABB operational use.

© 2025 ABB. All rights reserved.
────────────────────────────────────────────────────────────
```
