import { Boom } from '@hapi/boom';
import BaileysPkg from '@whiskeysockets/baileys';
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadMediaMessage 
} = BaileysPkg;

import pino from 'pino';
import express from 'express';
import QRCode from 'qrcode';

const logger = pino({ level: 'info' });

const app = express();
const port = process.env.PORT || 3000;
let currentQR = null;

app.get('/', async (req, res) => {
    if (currentQR) {
        try {
            const url = await QRCode.toDataURL(currentQR);
            res.send(`
                <div style="display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column;">
                    <h1>Scan this QR Code</h1>
                    <img src="${url}" alt="QR Code" width="300"/>
                    <p>Refresh page if QR expires.</p>
                </div>
            `);
        } catch (err) {
            res.status(500).send('Error generating QR code');
        }
    } else {
        res.send(`
            <div style="display:flex; justify-content:center; align-items:center; height:100vh;">
                <h1>Bot is connected and Running! 🚀</h1>
                <p>Check WhatsApp to ensure it's working.</p>
            </div>
        `);
    }
});

app.listen(port, () => {
    console.log(`Web QR Server running at: http://localhost:${port}`);
});

const messageStore = new Map();
const OWNER_JID = '923000000000@s.whatsapp.net'; 

async function processSingleDeletedMessage(sock, deletedMsg) {
    try {
        const remoteJid = deletedMsg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const senderName = deletedMsg.pushName || 'Unknown User';

        let location = 'Personal Chat';
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                location = `Group "${groupMeta.subject}"`;
            } catch (e) { location = "Unknown Group"; }
        }
        
        const deletedContent = deletedMsg.message?.conversation || deletedMsg.message?.extendedTextMessage?.text || "_(Media or Non-text message)_";
        const notification = `*🗑️ Message Deleted 🗑️*\n\n` +
                             `*👤 User:* ${senderName}\n` +
                             `*📍 Location:* ${location}\n` +
                             `*⏰ Time:* ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}\n` +
                             `*📜 Deleted Message:*\n${deletedContent}`;

        await sock.sendMessage(OWNER_JID, { text: notification });

        try {
            const buffer = await downloadMediaMessage(deletedMsg, 'buffer', {});
            let mediaMessage = {};
            if (deletedMsg.message.imageMessage) mediaMessage = { image: buffer, caption: "Deleted Image" };
            else if (deletedMsg.message.videoMessage) mediaMessage = { video: buffer, caption: "Deleted Video" };
            else if (deletedMsg.message.audioMessage) mediaMessage = { audio: buffer, mimetype: 'audio/mp4' };
            else if (deletedMsg.message.stickerMessage) mediaMessage = { sticker: buffer };
            else if (deletedMsg.message.documentMessage) mediaMessage = { document: buffer, mimetype: deletedMsg.message.documentMessage.mimetype, fileName: deletedMsg.message.documentMessage.fileName || "Deleted Document" };
            
            if (Object.keys(mediaMessage).length > 0) await sock.sendMessage(OWNER_JID, mediaMessage);
        } catch (e) { }
    } catch (e) {
        console.log(`Failed to process a deleted message: ${e.message}`);
    }
}

async function processSingleEditedMessage(sock, editEventMessage, originalMsgContent, newText) {
    try {
        const remoteJid = editEventMessage.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const senderName = editEventMessage.pushName || 'Unknown User';

        let location = 'Personal Chat';
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                location = `Group "${groupMeta.subject}"`;
            } catch (e) { location = "Unknown Group"; }
        }

        const originalContentText = originalMsgContent || "_(Original message not found in bot's memory)_";
        
        const notification = `*✏️ Message Edited ✏️*\n\n` +
                             `*👤 User:* ${senderName}\n` +
                             `*📍 Location:* ${location}\n` +
                             `*⏰ Time:* ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}\n\n` +
                             `*--- Original Message ---*\n${originalContentText}\n\n` +
                             `*--- Edited Message ---*\n${newText}`;

        await sock.sendMessage(OWNER_JID, { text: notification });
    } catch (e) {
        console.log(`Failed to process an edited message: ${e.message}`);
    }
}

async function startBot() {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys version v${version.join('.')}, isLatest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({ 
        version, 
        logger, 
        auth: state,
        shouldIgnoreJid: jid => typeof jid === 'string' && jid.includes('@broadcast'),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            currentQR = qr;
            console.log('QR Code generated. Check browser.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Connection opened! Bot is online. ✅');
            currentQR = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message.message || message.key.fromMe) return;

        const protocolMessage = message.message.protocolMessage;
        if (protocolMessage && protocolMessage.editedMessage) {
            const originalMsgId = protocolMessage.key.id;
            const originalMsg = messageStore.get(originalMsgId);
            const newText = protocolMessage.editedMessage.conversation;

            if (newText && originalMsg) {
                const originalContent = originalMsg.message?.conversation || originalMsg.message?.extendedTextMessage?.text;
                await processSingleEditedMessage(sock, message, originalContent, newText);
                
                originalMsg.message.conversation = newText;
                messageStore.set(originalMsgId, originalMsg);
            }
            return;
        }
        
        const id = message.key.id;
        if (!messageStore.has(id)) {
             messageStore.set(id, message);
             setTimeout(() => {
                 if (messageStore.has(id)) messageStore.delete(id);
             }, 60 * 60 * 1000);
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
            if (update.message === null) {
                const deletedMsg = messageStore.get(key.id);
                if (deletedMsg) {
                    await processSingleDeletedMessage(sock, deletedMsg);
                    messageStore.delete(key.id);
                }
            }
        }
    });

    return sock;
}

startBot().catch(err => {
    console.error("Error starting bot:", err);
});
