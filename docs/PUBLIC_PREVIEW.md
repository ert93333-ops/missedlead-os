# External app preview

URL: https://word-represented-lay-verse.trycloudflare.com

Checked 2026-09-05: HTTPS page and JavaScript asset returned 200; BrowserOS rendered Email, Password, Sign in, Create an account and Español controls. Protected API returned 401 without credentials. Auth and storage recovered. test/test login and the chatbot confirmation/matching/private-upload scenario now pass; see CHATBOT_DELIVERY_20260905.md and artifacts/demo-chat-smoke.json. This does not certify all production features or real-world diagnostic accuracy.

The hidden preview, API and cloudflared processes are recorded in artifacts/public-processes.json. This temporary link requires this PC and those processes to remain running. To stop exposure, verify the recorded tunnel process is cloudflared, then stop only that PID. Do not stop other project tunnels.

Reference: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
