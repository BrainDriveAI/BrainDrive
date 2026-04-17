# Twilio SMS MVP: Local Operator Guide

This guide covers end-to-end setup and validation of BrainDrive Twilio SMS in local Docker mode.

## Scope and webhook path

- Inbound webhook path: `/twilio/sms/webhook`
- Full webhook URL format: `https://<your-public-host>/twilio/sms/webhook`
- BrainDrive computes and displays the full URL in `Settings -> SMS (Twilio) -> Webhook URL`.

## Prerequisites

1. BrainDrive local/quickstart stack is running.
2. You have a Twilio account, an SMS-capable Twilio number, `Account SID`, and `Auth Token`.
3. You have a public HTTPS tunnel to your local BrainDrive instance.

## 1) Twilio account and phone number setup

1. In Twilio Console, acquire (or use) an SMS-capable number.
2. Confirm outbound SMS permissions for your destination country.
3. Copy:
   - `Account SID`
   - `Auth Token`
   - Twilio phone number (`+E.164` format)

## 2) Local public tunnel setup

Use any HTTPS tunnel provider. The tunnel must forward to local BrainDrive (normally `http://127.0.0.1:8080`).

Example with `cloudflared`:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Example with `ngrok`:

```bash
ngrok http 8080
```

Take the generated `https://...` origin and use it as `Public Base URL` in BrainDrive SMS settings.

## 3) Configure BrainDrive SMS settings

In BrainDrive UI: `Settings -> SMS (Twilio)`.

1. Set `Enabled = true`.
2. Fill:
   - `Account SID`
   - `From Number` (Twilio number)
   - `Public Base URL` (your tunnel origin only, no path)
3. Optional:
   - `Auto Reply`
   - `Strict Owner Mode` + `Owner Phone Number`
   - `Rate Limit Period` / `Rate Limit Cap`
4. Enter `Auth Token` (write-only field; blank keeps current token).
5. Click `Save SMS Settings`.
6. Click `Copy Webhook URL` and keep the copied URL for Twilio Console.

## 4) Configure Twilio webhook URLs

In Twilio Console for your number:

1. Under **Messaging**, set **A MESSAGE COMES IN** webhook to the copied BrainDrive webhook URL.
2. Recommended method: `HTTP POST`.
3. `SmsFallbackUrl` behavior:
   - If primary webhook fails (timeout/5xx), Twilio can call `SmsFallbackUrl`.
   - For local testing, set `SmsFallbackUrl` to the same endpoint or leave unset based on your incident workflow.
   - If set, verify fallback endpoint still uses HTTPS and signature validation.

## 5) Send Test SMS flow (outbound)

1. In BrainDrive SMS settings, set `Test Recipient` to your phone.
2. Enter a `Test Message`.
3. Click `Send Test SMS`.
4. Confirm:
   - UI success status
   - message delivery on recipient device
   - no secret/token exposure in UI payloads/log outputs

## 6) Inbound validation flow

1. Send an SMS to your Twilio number from your personal device.
2. Confirm BrainDrive receives inbound and creates/updates a conversation.
3. If `Auto Reply` is enabled, confirm an outbound response is sent.
4. In UI, verify `Last Inbound`, `Last Outbound`, `Current Usage`, and `Status` fields.

## 7) Replay/idempotency validation (MessageSid)

Replay the same Twilio webhook payload (same `MessageSid`) and confirm BrainDrive does not process it twice.

Expected behavior:

1. Endpoint still returns `200` empty TwiML.
2. Conversation is not duplicated.
3. Auto-reply is not sent again for the same `MessageSid`.

## 8) Strict-owner sender validation

With `Strict Owner Mode = true` and `Owner Phone Number` set:

1. Send from owner number: message is accepted.
2. Send from non-owner number: message is ignored (no processing/auto-reply).

## 9) Auto-reply rate-limit validation

1. Set small values (example: period `60`, cap `1`) for quick testing.
2. Send multiple inbound messages in the same period.
3. Confirm:
   - first message gets normal auto-reply
   - cap notice is sent once
   - later messages in same period are suppressed
4. After the period elapses, send again and confirm replies resume.

## 10) STOP/START/HELP behavior

Carrier/Twilio keyword handling applies before/around your app logic.

1. `STOP`: user opts out from your Twilio number; outbound messaging is blocked until re-opt-in.
2. `START` or `UNSTOP`: user re-subscribes for allowed traffic.
3. `HELP`: Twilio can return help messaging behavior per campaign/profile setup.

Validate keyword behavior with your Twilio number and messaging service configuration before production use.

## 11) US A2P 10DLC guidance

For US application-to-person traffic on long codes:

1. Complete brand and campaign registration in Twilio A2P 10DLC.
2. Use approved use cases and sample messages aligned with your campaign.
3. Expect throughput and filtering differences before and after registration.
4. Keep opt-in/opt-out/help workflows and logs consistent with campaign requirements.

## Operator checklist

1. Save SMS settings successfully.
2. Copy webhook URL from BrainDrive UI.
3. Send Test SMS succeeds.
4. Receive inbound SMS via Twilio webhook.
5. Inspect linked conversation in BrainDrive.
6. Replay same payload and confirm idempotent handling.
7. Validate strict-owner acceptance/rejection paths.
8. Validate auto-reply behavior.
9. Validate rate-limit suppression and post-window reset behavior.
