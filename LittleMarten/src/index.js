const { Client, IntentsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
    console.error('Config file not found!');
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ]
});

const roleCachePath = './roleCache.json';

// Load or initialize role cache
let roleCache = {};
if (fs.existsSync(roleCachePath)) {
    roleCache = JSON.parse(fs.readFileSync(roleCachePath, 'utf8'));
}

function saveRoleCache() {
    fs.writeFileSync(roleCachePath, JSON.stringify(roleCache, null, 2));
}

client.once('ready', () => {
    console.log('Bot is online!');
});

// Helper function to parse arguments, allowing quotes for role names
function parseArguments(message) {
    const regex = /"([^"]+)"|(\S+)/g;
    const args = [];
    let match;
    while ((match = regex.exec(message)) !== null) {
        args.push(match[1] || match[2]);
    }
    return args;
}

// Function to send help message
function sendHelpMessage(channel) {
    const helpMessage = `
**!pretty Command List:**
\`!pretty "role name" <hexcode or "default">\` - Creates or updates a role with the provided name and color (hexcode or default for colorless).
\`!pretty "role name" <hexcode> <role#>\` - Creates or updates an additional role with the given number.
\`!pretty help\` - Displays this help message.
    `;
    channel.send(helpMessage);
}

client.on('messageCreate', async message => {
    if (message.author.bot) return; // Ignore bot messages

    const args = parseArguments(message.content.slice(1).trim());

    // Handle help command
    if (args[0].toLowerCase() === 'pretty' && args[1] && args[1].toLowerCase() === 'help') {
        return sendHelpMessage(message.channel);
    }

    if (!message.content.startsWith('!pretty')) return;
    
    // Ensure there's at least a role name and color
    if (args.length < 3) {
        return message.channel.send('Please provide a role name in quotes and hex color code or "default".');
    }

    const roleName = args[1];
    const colorHex = args[2].toLowerCase() === 'default' ? null : args[2];
    const roleNumber = args[3]; // Optional role number for additional roles

    // Validate hex code if it's not "default"
    if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
        return message.channel.send('Invalid hex color code. Please use a format like #RRGGBB, or use "default" for no color.');
    }

    try {
        const userRoles = roleCache[message.author.id] || {};
        let existingRoleID;

        if (Object.keys(userRoles).length === 0) {
            // First role for the user, no role number needed
            existingRoleID = userRoles[1]; // Treat it as role #1 by default
        } else {
            // Check if they provided a role number for additional roles
            if (!roleNumber) {
                return message.channel.send('Please specify a role number for additional roles.');
            }
            existingRoleID = userRoles[roleNumber];
        }

        let role;

        // Find the "🅥🅐🅝🅘🅣🅨 🅡🅞🅛🅔🅢" role in the server
        const vanityRole = message.guild.roles.cache.find(r => r.name === '🅥🅐🅝🅘🅣🅨 🅡🅞🅛🅔🅢');

        if (!vanityRole) {
            return message.channel.send('Could not find the "🅥🅐🅝🅘🅣🅨 🅡🅞🅛🅔🅢" role.');
        }

        if (existingRoleID) {
            role = await message.guild.roles.fetch(existingRoleID).catch(() => null);
        }

        if (role) {
            // Update existing role name and color
            await role.setName(roleName);
            if (colorHex) {
                await role.setColor(colorHex);
            } else {
                await role.setColor(null); // Set to default color if "default" was used
            }
        } else {
            // Create new role
            role = await message.guild.roles.create({
                name: roleName,
                color: colorHex || null, // Null color for "default"
                reason: `Role created by !pretty command`,
            });
        }

        // Move the role directly under the "🅥🅐🅝🅘🅣🅨 🅡🅞🅛🅔🅢" role in the hierarchy
        await role.setPosition(vanityRole.position - 1);

        // Assign the role to the user
        await message.member.roles.add(role);

        // Update the role cache with the specific role number
        if (Object.keys(userRoles).length === 0) {
            // First role, assign it as role #1
            userRoles[1] = role.id;
        } else {
            // Assign it based on the provided role number
            userRoles[roleNumber] = role.id;
        }
        roleCache[message.author.id] = userRoles;
        saveRoleCache();

        message.channel.send(`Role "${roleName}" created/updated and assigned to you with color ${colorHex || 'default (no color)'}.`);
    } catch (error) {
        console.error('Error creating/updating role:', error);
        message.channel.send('There was an error creating or updating the role.');
    }
});

client.login(config.token).catch(err => {
    console.error('Failed to login:', err);
});
