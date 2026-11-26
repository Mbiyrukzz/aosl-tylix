import type { Router } from '@tylix/core'
import { UploadController } from '../controllers/UploadController.js'

// The app's API lives in the other files in this folder:
//   public.ts  status page, contact form, careers (no login)
//   client.ts  the client portal: account, tickets, messages, services,
//              projects, billing, company and team
//   admin.ts   the staff console
export async function publicRoutes(_router: Router) {}

// Protected routes: every route here requires a logged-in user.
export async function protectedRoutes(router: Router) {
  const uploads = new UploadController()

  // Images (avatars, screenshots). Documents go to /api/uploads/file.
  router.post('/api/uploads', (req, res) => uploads.store(req, res))
}
