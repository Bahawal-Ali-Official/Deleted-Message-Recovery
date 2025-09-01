🚀 WhatsApp Anti-Delete Bot
A simple WhatsApp bot built with Node.js and @whiskeysockets/baileys. It automatically forwards any deleted messages, including text and media, to your personal number.

✨ Features
Recovers Messages: Catches deleted text, images, videos, stickers, and documents.

Works Everywhere: Functions in both private chats and groups.

Efficient: Handles multiple deletions at once without slowing down.

Forwards Notifications: Sends all recovered messages to a number you specify.

⚙️ Setup Guide
Requirements: Node.js (v18.x or higher) is required.


2. Install Dependencies:

npm install

3. Configure Owner Number:
Open the index.js file and edit the following line with your personal WhatsApp number (including country code, e.g., 923001234567):

const OWNER_JID = 'YOUR_NUMBER_HERE@s.whatsapp.net';

4. Run the Bot:

node index.js

Scan the QR code that appears in the terminal using the "Linked Devices" feature in your WhatsApp app. Once scanned, your bot is online!
