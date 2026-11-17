# FamGuard profiles, family connections, and live locations

## Apply the database schema

In the Supabase project used by FamGuard, open **SQL Editor**, paste the complete contents of `supabase/schema.sql`, and run it. The script adds profile and family-request tables, secured RPC functions, row-level security policies, and Realtime publication entries. Do not run only the original first section.

The app must also have `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured in `.env.local` for local testing and in Vercel for the deployed app. Never use a Supabase service-role key in the browser app.

## First sign-in and profile

After the first email/password or Google sign-in, FamGuard opens profile setup. Name and family role are required; phone number and birthday are optional. Age is calculated from the optional birthday and shown only to the profile owner. Phone, birthday, and age are not returned to family members.

FamGuard generates an immutable, 16-character ID for each profile. Share it only with people you trust. A person who enters the ID sees the account name and role and can send a request. The connection is created only after the recipient accepts it in **Fam-Dash**.

## Location privacy and testing

Location tracking and family sharing are separate, explicit choices on the **Locations** page. Tracking requires a secure page (HTTPS or localhost) and browser location permission. Sharing is off by default; only accepted connections can read a recent location while its owner has sharing enabled. A shared location older than two minutes is no longer returned to family members. Browser background execution is not guaranteed, so this is not a continuous emergency-tracking service.

To display a pin, select **Show on map**. FamGuard then sends the selected coordinates to OpenStreetMap to render its map. Location coordinates otherwise remain in the Supabase project; family members see them only under the row-level security policy.

To test end to end, use two signed-in accounts: complete both profiles, copy one account's ID into the other account's Fam-Dash, accept the incoming request, then enable tracking and location sharing on the account whose location should be visible. Grant browser location permission and choose **Show on map**. Turn tracking off afterward to remove the saved location.
