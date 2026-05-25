const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const {Resend} = require("resend");

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

// Named 'scalebooks' Firestore database
const db = getFirestore("scalebooks");

// Resend API key stored as Firebase secret
const resendApiKey = defineSecret("RESEND_API_KEY");

/**
 * Invites a user: sends a branded invitation email via Resend.
 * The invited user signs in with their Google account — no password needed.
 * Called from SettingsPage (new invite) and the Resend Invite button.
 */
exports.createAuthUser = onCall(
    {secrets: ["RESEND_API_KEY"]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be signed in.");
      }

      const {email, fullName} = request.data;
      if (!email || typeof email !== "string") {
        throw new HttpsError("invalid-argument", "A valid email is required.");
      }

      // Verify caller is an Admin in appUsers
      const callerEmail = (request.auth.token.email || "").toLowerCase();
      const snap = await db
          .collection("appUsers")
          .where("email", "==", callerEmail)
          .limit(1)
          .get();
      const isAdmin =
        !snap.empty && (snap.docs[0].data().roles || []).includes("Admin");

      if (!isAdmin) {
        throw new HttpsError(
            "permission-denied",
            "Only Admins can invite users.",
        );
      }

      // Send invitation email via Resend
      const appUrl = "https://scalebooks-9a629.web.app/login";
      const resend = new Resend(resendApiKey.value());

      const {error} = await resend.emails.send({
        from: "ScaleBooks Finance Portal <noreply@accountingsystem.online>",
        to: email.trim().toLowerCase(),
        subject: "You've been invited to ScaleBooks Finance Portal",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#f97316;margin-bottom:8px;">You've been invited!</h2>
            <p style="color:#374151;">Hi ${fullName || "there"},</p>
            <p style="color:#374151;">
              You have been invited to access the
              <strong>ScaleBooks Finance Portal</strong> by Workscale Resources Inc.
            </p>
            <p style="color:#374151;">Click the button below and sign in with your Google account to get started:</p>
            <p style="text-align:center;margin:24px 0;">
              <a href="${appUrl}"
                 style="background:#f97316;color:#fff;padding:13px 28px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                Sign In to ScaleBooks
              </a>
            </p>
            <p style="color:#94a3b8;font-size:12px;">
              If you weren't expecting this invitation, you can safely ignore this email.
            </p>
          </div>
        `,
      });

      if (error) {
        throw new HttpsError("internal", `Email send failed: ${error.message}`);
      }

      return {sent: true};
    },
);
