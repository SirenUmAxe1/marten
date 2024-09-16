const { Client, IntentsBitField, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load the config file
const config = require('./config.json');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember
    ]
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    maintainMessages();
    setInterval(maintainMessages, 3600000); // Check every hour
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = "!";
    if (message.content.startsWith(prefix)) {
        const [command, ...args] = message.content.slice(prefix.length).trim().split(/ +/g);

        if (command.toLowerCase() === "checklinks") {
            await checkLinksInServer(message);
        } else if (command.toLowerCase() === "fartchannel") {
            await deleteChannelContent(message);
        }
    } else {
        await handleNeverPingRole(message);
    }
});

async function checkLinksInServer(message) {
    const guild = message.guild;
    if (!guild) {
        console.error("Unable to find the guild.");
        return;
    }

    const threadId = message.channel.id; // ID of the thread where the command was sent
    const channels = guild.channels.cache.filter(c => c.isTextBased() && c.permissionsFor(guild.members.me).has('VIEW_CHANNEL'));

    let allMentions = {};
    let uniqueMentions = new Set(); // To track unique mentions

    // Send a "checking" message
    let checkingMessage;
    try {
        checkingMessage = await message.channel.send("Checking for links...");
    } catch (error) {
        console.error('Error sending the checking message:', error);
        return;
    }

    try {
        for (const channel of channels.values()) {
            // Skip private channels
            if (!channel.permissionsFor(guild.members.me).has('VIEW_CHANNEL')) {
                continue;
            }

            console.log(`Fetching messages from channel ${channel.name}`);

            // Check messages in main channel
            await fetchMessages(channel, threadId, uniqueMentions, allMentions);

            // Check messages in threads if it's a text channel
            if (channel.isTextBased() && channel.type !== 12) {
                try {
                    // Fetch threads in the channel
                    const threads = await channel.threads.fetch();

                    for (const [id, thread] of threads.threads) {
                        console.log(`Fetching messages from thread ${thread.name}`);
                        await fetchMessages(thread, threadId, uniqueMentions, allMentions);
                    }
                } catch (error) {
                    console.error(`Error fetching threads from ${channel.name}:`, error);
                }
            }
        }

        // Delete the command message
        try {
            await message.delete();
        } catch (error) {
            console.error('Error deleting the command message:', error);
        }

        // Delete previous responses in the channel
        try {
            const fetchedMessages = await message.channel.messages.fetch({ limit: 100 });
            fetchedMessages.forEach(msg => {
                if (msg.author.id === client.user.id && msg.id !== checkingMessage.id) {
                    msg.delete().catch(console.error);
                }
            });
        } catch (error) {
            console.error('Error deleting previous messages:', error);
        }

        // Prepare the mentions message
        const mentionsMessage = Object.values(allMentions).join(', ');

        // Send the collected mentions as a new message
        let response;
        if (mentionsMessage) {
            response = await message.channel.send(`**Recent Mentions:** ${mentionsMessage}`);
        } else {
            response = await message.channel.send("No mentions found.");
        }

        // Log the links
        logLinks(message.channel.name, uniqueMentions);

        // Delete the "checking" message
        try {
            await checkingMessage.delete();
        } catch (error) {
            console.error('Error deleting the checking message:', error);
        }
    } catch (error) {
        console.error('Error checking links in server:', error);
    }
}

async function fetchMessages(channel, threadId, uniqueMentions, allMentions) {
    let lastMessageId = null;
    let hasMoreMessages = true;

    while (hasMoreMessages) {
        let fetchedMessages;
        try {
            if (lastMessageId) {
                fetchedMessages = await channel.messages.fetch({ limit: 100, before: lastMessageId });
            } else {
                fetchedMessages = await channel.messages.fetch({ limit: 100 });
            }
        } catch (error) {
            console.error(`Error fetching messages from ${channel.name}:`, error);
            break;
        }

        if (fetchedMessages.size === 0) {
            hasMoreMessages = false;
            break;
        }

        const mentions = [];

        for (const [id, msg] of fetchedMessages) {
            // Check if the message content contains the thread ID directly or within a URL
            if (msg.content.includes(`<#${threadId}>`) || containsThreadIdInURL(msg.content, threadId)) {
                const url = msg.url;
                if (!uniqueMentions.has(url)) {
                    mentions.push({ url, timestamp: msg.createdTimestamp });
                    uniqueMentions.add(url); // Add to unique set
                }
            }
        }

        if (mentions.length > 0) {
            // Track the most recent mention for this channel
            const mostRecentMention = mentions.reduce((latest, current) => {
                return current.timestamp > latest.timestamp ? current : latest;
            }, { timestamp: 0 }); // Initialize with the lowest possible timestamp
            if (mostRecentMention.url) {
                allMentions[channel.id] = mostRecentMention.url; // Store only the most recent link
            }
        }

        // Update lastMessageId for next fetch
        lastMessageId = fetchedMessages.last().id;
    }
}

function containsThreadIdInURL(content, threadId) {
    // Regex to match URLs with channel and thread ID
    const urlRegex = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)/g;
    let match;

    while ((match = urlRegex.exec(content)) !== null) {
        const [_, channelId, id] = match;
        if (id === threadId) {
            return true;
        }
    }

    return false;
}

function logLinks(channelName, links) {
    const logFile = path.join(__dirname, 'linkLogs.json');

    // Load existing log file
    let logData = {};
    if (fs.existsSync(logFile)) {
        logData = JSON.parse(fs.readFileSync(logFile));
    }

    // Update log data
    if (!logData[channelName]) {
        logData[channelName] = [];
    }

    links.forEach(link => {
        if (!logData[channelName].includes(link)) {
            logData[channelName].push(link);
        }
    });

    // Save updated log file
    fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
}

async function handleNeverPingRole(message) {
    const neverPingRoleName = "never ping";
    const staffRoleName = "Staff";

    if (!message.mentions.users.size) return;

    const guild = message.guild;
    const neverPingRole = guild.roles.cache.find(role => role.name === neverPingRoleName);
    const staffRole = guild.roles.cache.find(role => role.name === staffRoleName);

    if (!neverPingRole) {
        console.error(`Role "${neverPingRoleName}" not found.`);
        return;
    }

    let mentionedNeverPingUser = false;

    message.mentions.users.forEach(user => {
        const member = guild.members.cache.get(user.id);
        if (member && member.roles.cache.has(neverPingRole.id)) {
            mentionedNeverPingUser = true;
        }
    });

    if (mentionedNeverPingUser) {
        const pinger = message.author;
        const staffMention = staffRole ? `<@&${staffRole.id}>` : "@Staff";

        const response = `<@${pinger.id}>, you have pinged a user with the 'never ping' role! Please respect their preferences in the future.\nPsst, ${staffMention} ! Check this ping!`;

        message.channel.send(response).catch(console.error);
    }
}

async function deleteChannelContent(message) {
    const ownerRoleName = "Owner";
    const guild = message.guild;
    const ownerRole = guild.roles.cache.find(role => role.name === ownerRoleName);

    if (!ownerRole) {
        console.error(`Role "${ownerRoleName}" not found.`);
        return;
    }

    const member = guild.members.cache.get(message.author.id);
    if (!member.roles.cache.has(ownerRole.id)) {
        return; // If the user doesn't have the Owner role, do nothing
    }

    const channel = message.channel;

    // Delete all messages in the channel
    try {
        let fetchedMessages;
        do {
            fetchedMessages = await channel.messages.fetch({ limit: 100 });
            await channel.bulkDelete(fetchedMessages, true);
        } while (fetchedMessages.size >= 2);
    } catch (error) {
        console.error('Error deleting messages:', error);
    }

    // Delete all threads in the channel
    try {
        const threads = await channel.threads.fetchActive();
        for (const [id, thread] of threads.threads) {
            await thread.delete().catch(console.error);
        }

        const archivedThreads = await channel.threads.fetchArchived();
        for (const [id, thread] of archivedThreads.threads) {
            await thread.delete().catch(console.error);
        }
    } catch (error) {
        console.error('Error deleting threads:', error);
    }
}

async function maintainMessages() {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
        console.error("Unable to find the guild.");
        return;
    }

    const channel = guild.channels.cache.find(c => c.name === "rp-discussion" && c.isTextBased());
    if (!channel) {
        console.error("Unable to find the rp-discussion channel.");
        return;
    }

    const thread = channel.threads.cache.find(t => t.name === "RP Concerns, etc.");
    if (!thread) {
        console.error("Unable to find the RP Concerns, etc. thread.");
        return;
    }

    const welcomeMessageContent = `# Welcome to the RPC thread!
To use this thread, simply post one message and edit it as needed, then you can send the link to anyone you want to give this information to such as RP partners or spectated RPers. After you finish posting your message, leave the thread to get it off your channel list.
### Rules
- Users who do not memorize your triggers will not be reprimanded for slipping up.
- If you are targeted with triggering material, the perpetrator will be turned into ash.`;

    const templateMessageContent = `## Template
*This template is completely optional, and you can say pretty much whatever you want in your RPC message.*
### Triggers
\`Here, you can list any triggers you might have and, if you'd like, go into depth about at what point something like this triggers you.\`
### Style
**Tense:** \`Past / Present\`
**POV:** \`First / Second / Third\` *Most people RP in third person.*
**Sample:** \`Examples of tense, for those who aren't sure: He stepped into the clearing / He steps into the clearing\`
### Misc. Info/Concerns
\`Here, you could say something like: "I don't like combat RP," "I get second-hand embarrassment," "When characters are mad, I feel nervous," "I like my characters to be little shits," "MY OCS MUST SUFFER!"\``;

    try {
        const messages = await thread.messages.fetch({ limit: 100 });
        const botMessages = messages.filter(msg => msg.author.id === client.user.id);

        for (const msg of botMessages.values()) {
            await msg.delete();
        }

        await thread.send(welcomeMessageContent);
        await thread.send(templateMessageContent);
    } catch (error) {
        console.error('Error maintaining messages in the thread:', error);
    }
}

client.login(config.token);
