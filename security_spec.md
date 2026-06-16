# Security Specification for Personal Knowledge Base Q&A Platform

This document describes the security model, invariants, and threat vectors for the Firestore database.

## 1. Data Invariants

1. **User Ownership**:
   - A user profile (`/users/{userId}`) can only be created, read, or updated by the authenticated user with the matching `userId`.
   - Users cannot elevate their own role or privileges.

2. **Workspace Isolation**:
   - Workspaces (`/workspaces/{workspaceId}`) can only be accessed (read/written) by users whose UID matches the `ownerId` or exists in the `members` array.
   - For any nested resources (Documents, Chunks, Conversations, Messages), access is inherited by validating membership on the parent workspace using `get(/databases/$(database)/documents/workspaces/$(workspaceId))` matching `request.auth.uid`.

3. **Input Validation**:
   - Document names, workspace names, and message formats must conform to maximum length and regex guards to prevent injection/wallet exhaustion.

---

## 2. The "Dirty Dozen" Payloads (Exploit Scenarios)

The following malicious configurations return `PERMISSION_DENIED` thanks to our fortress rules:

1. **Self-Profile Hijack**: Attempting to write or overwrite `/users/userABC` when authenticated as `userXYZ`.
2. **Infinite Workspace Members**: Attempting to insert 10,000 members into a workspace to crash rule execution (bounded list constraint).
3. **Foreign Workspace Read**: Attempting to list documents under `/workspaces/sharedSpaceA/documents/doc1` when the caller is not a member or owner of `sharedSpaceA`.
4. **Foreign Document Write**: Attempting to write a document metadata under workspace `A` when the caller is not authenticated or not in workspace `A` membership.
5. **Orphaned Doc ID Spoofing**: Injecting raw invalid text like `/workspaces/../documents` or excessively long IDs to bypass regex / size limits.
6. **Self-Appointed Workspace Promotion**: Attempting to update workspace `ownerId` to someone else to force-transfer ownership without authorization.
7. **Bypassing Document Validation**: Submitting a document record with missing required fields or incorrect types (e.g. `status` as an integer).
8. **Malicious Message Injection**: Injecting a message into a conversation under another user's workspace.
9. **RAG Chunk Modification**: A workspace user or non-workspace caller trying to update semantic embeddings or chunk texts directly via client SDK.
10. **Unauthorized Chat Creation**: Non-workspace user trying to insert a conversation thread.
11. **Shadow Keys**: Attempting to write a document with undocumented properties (e.g., `role: "admin"` or `hacked: true`).
12. **PII Data Exposure**: A nested user profile query fetching data containing user emails or private data without specific `isOwner` validation.

---

## 3. The Test Runner Spec

We enforce that all security controls reject the irregular structures mentioned above, as written in `/firestore.rules`.
