# Platform staff guide

Who this is for: NestSelf staff who work in NestSelf Admin. The pictures show fictional sample people.

---

## Sign in

1. Open NestSelf Admin, type your work email address and press **Continue**.

   <p><img src="../screenshots/guide-admin-sign-in.png" alt="Sign in" width="60%"></p>

2. Type your password and press **Sign in**.

   <p><img src="../screenshots/guide-admin-sign-in-password.png" alt="Enter your password" width="60%"></p>

3. The first time, scan the QR code with your authenticator app, type the code it shows and press **Confirm setup**.

   <img src="../screenshots/guide-admin-totp-enrol.png" alt="Set up two-factor authentication" width="60%"> _The QR code and the key are hidden in this picture._

4. Every other time, type the code from your authenticator app and press **Verify**.

   <p><img src="../screenshots/guide-admin-sign-in-authenticator.png" alt="Two-factor authentication" width="60%"></p>

   **If it fails:** "The code you entered is not valid." Wait for the next code in the app and type it.

## Clients and users

1. Choose **Organisations** and open the client.

   <p><img src="../screenshots/admin-organizations.png" alt="Organisations" width="100%"></p>

2. Open **People** to see the members and end a membership.

   <p><img src="../screenshots/admin-org-people.png" alt="Organisation detail, People" width="100%"></p>

3. Open **Access** to assign or revoke templates and transfer ownership.

   <p><img src="../screenshots/admin-org-access.png" alt="Organisation detail, Access" width="100%"></p>

4. To check a user, choose **Access** in the menu, type the user ID under **User access** and press **Look up**.

   <p><img src="../screenshots/guide-admin-user-lookup.png" alt="User access" width="75%"></p>

5. To suspend that user, press **Suspend user**, type the reason and press **Suspend user**.

   <p><img src="../screenshots/guide-admin-user-suspend.png" alt="Suspend this user?" width="65%"></p>

6. To lift a suspension, look the user up, press **Reinstate user** and press **Reinstate user** again.

   <p><img src="../screenshots/guide-admin-user-reinstate.png" alt="Reinstate this user?" width="65%"></p>

## Emergency access

1. Choose **Emergency access**, press **Request access**, write the purpose, choose **Case** or **Person's records** and type its ID, choose the **Duration** and press **Send request**.

   <p><img src="../screenshots/guide-admin-emergency-request.png" alt="Request emergency access" width="60%"></p>

2. If **Verify your identity** opens, type the code NestSelf emailed you and press **Verify**.

   <p><img src="../screenshots/guide-admin-emergency-step-up.png" alt="Verify your identity" width="65%"></p>

3. Ask another staff member to press **Approve** on your request and confirm.

   <p><img src="../screenshots/guide-admin-emergency-approve.png" alt="Approve this emergency access?" width="65%"></p>

4. When your request shows **Active**, press **Open record**.

   <p><img src="../screenshots/admin-emergency-list.png" alt="Emergency access" width="100%"></p>

5. Choose the **Record type**, type the record ID and press **Read record**.

   <p><img src="../screenshots/guide-admin-emergency-record.png" alt="Read a record under emergency access" width="75%"></p>

## Single sign-on for a client

1. Choose **SSO**, press **New connection**, find the organisation, choose the protocol, type a slug, fill in the provider details from the client and press **Create connection**.

   <p><img src="../screenshots/guide-admin-sso-create-connection.png" alt="New SSO connection" width="60%"></p>

   **If it fails:** "Another organisation already uses this slug for its SSO connection. Choose a different slug."

2. Press **Details** on the new connection.

   <p><img src="../screenshots/guide-admin-sso-connection.png" alt="Connection details" width="100%"></p>

3. Press **Add domain**, type the client's email domain and press **Add domain**.

   <p><img src="../screenshots/guide-admin-sso-add-domain.png" alt="Add domain" width="65%"></p>

   **If it fails:** "Public email domains such as gmail.com cannot be used for SSO. Use the employer's own domain."

4. Send the client the **Record name** and **Record value** to publish in their DNS, and press **Done**.

   <img src="../screenshots/guide-admin-sso-dns-record.png" alt="Publish this DNS record" width="65%"> _The record value is hidden in this picture._

5. Send the client the **Entity ID** and **ACS URL** for their identity provider; the domain waits as **Pending** with its record.

   <img src="../screenshots/guide-admin-sso-values.png" alt="Values for the employer's identity provider, and the pending domain" width="100%"> _The record value is hidden in this picture._

6. When the client has published the record, press **Verify** next to the domain.

   <p><img src="../screenshots/guide-admin-sso-domain-verified.png" alt="Domain verified" width="100%"></p>

   **If it fails:** "The DNS TXT record was not found or does not match. Check the record name and value, or wait for DNS to update, and try again."

7. Press **Test sign-in**, then open the link in a new tab or send it to the client's tester, an invited person with an address on the verified domain.

   <img src="../screenshots/guide-admin-sso-test-link.png" alt="Test sign-in link" width="100%"> _Part of the link is hidden in this picture._

8. When the test sign-in has finished, press **Activate**; the connection shows **Active**.

   <p><img src="../screenshots/guide-admin-sso-activated.png" alt="Connection activated" width="100%"></p>

   **If it fails:** "Complete a test sign-in on a verified domain before activating the connection." Run the test sign-in again.

## Suspend or reset a connection

1. Press **Suspend** and confirm to stop sign-in through the client's provider; **Reactivate** restarts it.

   <p><img src="../screenshots/guide-admin-sso-suspend.png" alt="Suspend this connection?" width="65%"></p>

2. Press **Reset to draft** and confirm to start a connection in testing over.

   <p><img src="../screenshots/guide-admin-sso-reset.png" alt="Reset this connection to draft?" width="65%"></p>

## What to tell the client about `email_verified`

Ask whether their OIDC sign-in sends `email_verified` (Entra ID does not by default). If it does not, leave **Require a verified email claim from the provider** on: each employee then confirms their address once with a code NestSelf sends them. Turn it off (**Edit**) only after the client confirms in writing that the email their sign-in sends is their directory's verified address.

## Verify your identity

1. When **Verify your identity** opens as you suspend or reinstate a user, end a membership, change access, or open or change SSO connections more than 30 minutes since you signed in or last verified your identity, type the code NestSelf emailed you and press **Verify**.

   <p><img src="../screenshots/guide-admin-emergency-step-up.png" alt="Verify your identity" width="65%"></p>

   **If it fails:** "The code you entered is not valid." Type the code from the newest email, or press **Send a new code**.

2. Press **Cancel** instead to leave the change undone. On the **SSO** page the connections then stay hidden until you press **Try again** and verify.
