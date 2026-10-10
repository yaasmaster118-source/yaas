# YAAS account and media security

DM audio and video are measured on the server using ffprobe, including packet timestamps for recordings without a declared duration. Files longer than 120 seconds, unreadable media, and mismatched audio/video streams are rejected before database insertion. Probes have a 15-second timeout, a bounded output buffer, local-only input protocols, and at most two simultaneous processes. The existing 8 MB size and storage quotas remain enforced.

Password recovery and email verification require `RESEND_API_KEY`, `SECURITY_ALERT_FROM`, and an HTTPS `PUBLIC_APP_URL`. They are not operational until delivery from a verified sender is configured. Tokens expire after 30 minutes, are stored only as SHA-256 hashes, and can be used once. Resetting a password revokes existing sessions. Verified social login marks the email as verified. Verification does not give users ownership privileges.

User blocks stop new DMs, friend requests and message requests in both directions, including acceptance of pending requests. History is preserved. Users can remove their own blocks in Settings → My account. Reports are stored privately and are visible only to the YAAS owner, who can close or reopen them. Reports also enter the existing security event and configured alert pipeline. Blocks do not mute shared server channels.

The CI keeps dependency install scripts disabled and installs ffprobe from Ubuntu's package repository. Docker uses the Debian system ffprobe; Render uses the pinned platform package. See the package's binary source and licensing information: https://github.com/eugeneware/ffmpeg-static.
