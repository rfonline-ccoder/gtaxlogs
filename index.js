const { Client, GatewayIntentBits, ButtonBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const mysql = require('mysql2');
const moment = require('moment');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Настройка базы данных
const db = mysql.createConnection({
    host: 'gtax-rp.ru',
    user: 'loger',
    password: 'dsslSMeHOO20',
    database: 'logs'
});

client.once('ready', () => {
    console.log('Bot is online!');

    // Отправка начального сообщения с селектором таблиц
    const channel = client.channels.cache.get('1270370920799797350');
    if (channel) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('table_select')
            .setPlaceholder('Выберите таблицы для поиска')
            .setMinValues(1)
            .setMaxValues(5) // Можно выбрать до 5 таблиц
            .addOptions(
                { label: 'ban', value: 'ban' },
                { label: 'connection', value: 'connection' },
                { label: 'death', value: 'death' },
                { label: 'fine', value: 'fine' },
                { label: 'fractionAction', value: 'fractionAction' },
                { label: 'fractionResource', value: 'fractionResource' },
                { label: 'kick', value: 'kick' },
                { label: 'mute', value: 'mute' },
                { label: 'prisoner', value: 'prisoner' },
                { label: 'releasePrissoner', value: 'releasePrissoner' },
                { label: 'transaction', value: 'transaction' },
                { label: 'unban', value: 'unban' },
                { label: 'unmute', value: 'unmute' },
                { label: 'unwarn', value: 'unwarn' },
                { label: 'wallet', value: 'wallet' },
                { label: 'warn', value: 'warn' }
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        channel.send({ content: 'Выберите таблицы для запроса логов:', components: [row] });
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'table_select') { 
        const selectedTables = interaction.values.join(',');

        const modal = new ModalBuilder()
            .setCustomId('log_request')
            .setTitle('Запрос логов');

        const staticIdInput = new TextInputBuilder()
            .setCustomId('static_id')
            .setLabel('Статический ID')
            .setStyle(TextInputStyle.Short);

        const dateInput = new TextInputBuilder()
            .setCustomId('date_range')
            .setLabel('Диапазон дат (DD-MM-YYYY - DD-MM-YYYY)')
            .setStyle(TextInputStyle.Short);

        const tablesInput = new TextInputBuilder()
            .setCustomId('tables')
            .setLabel('Выбранные таблицы')
            .setValue(selectedTables)
            .setStyle(TextInputStyle.Short);

        const firstActionRow = new ActionRowBuilder().addComponents(staticIdInput);
        const secondActionRow = new ActionRowBuilder().addComponents(dateInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(tablesInput);

        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'log_request') {
        const staticId = interaction.fields.getTextInputValue('static_id');
        const dateRange = interaction.fields.getTextInputValue('date_range');
        const tables = interaction.fields.getTextInputValue('tables').split(',');

        const dates = dateRange.split(' - ');
        const startDate = moment(dates[0], 'DD-MM-YYYY').format('YYYY-MM-DD');
        const endDate = dates[1] ? moment(dates[1], 'DD-MM-YYYY').format('YYYY-MM-DD') : null;

        if (!startDate || !endDate || !moment(startDate, 'YYYY-MM-DD', true).isValid() || !moment(endDate, 'YYYY-MM-DD', true).isValid()) {
            await interaction.reply({ content: 'Указан некорректный диапазон дат. Пожалуйста, используйте формат DD-MM-YYYY - DD-MM-YYYY.', ephemeral: true });
            return;
        }

        // Закрытие модального окна
        await interaction.deferUpdate();

        const guild = interaction.guild;
        const user = interaction.user;
        const category = interaction.channel.parent;

        const privateChannel = await guild.channels.create({
            name: `${user.username}-logs`,
            type: 0, 
            parent: category,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                },
            ],
        });

        // Определяем цвета для разных таблиц
        const tableColors = {
            ban: '#FF0000',
            connection: '#FFA500',
            death: '#FF0000',
            fine: '#0000FF',
            fractionAction: '#800080',
            fractionResource: '#800080',
            kick: '#FF0000',
            mute: '#FF0000',
            prisoner: '#FF0000',
            releasePrissoner: '#008000',
            transaction: '#FFA500',
            unban: '#008000',
            unmute: '#008000',
            unwarn: '#008000',
            wallet: '#000000',
            warn: '#FF0000'
        };

        for (const table of tables) {
            const tableName = table.trim();
            if (!tableName) continue;

            let dateColumn = 'Date';
            if (tableName === 'connection') {
                dateColumn = 'EnterDate';
            }

            // Показываем столбцы в таблице и фильтруем по доступным
            db.query(`SHOW COLUMNS FROM ${tableName}`, (err, columns) => {
                if (err) {
                    console.error(`Ошибка при получении столбцов из таблицы ${tableName}:`, err);
                    privateChannel.send(`Ошибка при получении столбцов из таблицы ${tableName}.`);
                    return;
                }

                const availableColumns = columns.map(col => col.Field);
                const idColumns = [
                    'CharacterId',
                    'KillerCharacterId',
                    'GivenCharacterId',
                    'AdminId',
                    'FromId',
                    'ToId',
                    'ReleasedId',
                    'FromCharacterId',
                    'ToCharacterId',
                    'FromId'
                ].filter(col => availableColumns.includes(col));

                if (idColumns.length === 0) {
                    privateChannel.send(`В таблице ${tableName} нет доступных столбцов для поиска по ID.`);
                    return;
                }

                const conditions = idColumns.map(column => `${column} = ?`).join(' OR ');
                const query = `SELECT * FROM ${tableName} WHERE (${conditions}) AND ${dateColumn} BETWEEN ? AND ?`;
                const queryValues = [...Array(idColumns.length).fill(staticId), startDate, endDate];

                db.query(
                    query,
                    queryValues,
                    async (error, results) => {
                        if (error) {
                            console.error(`Ошибка в таблице ${tableName}:`, error);
                            privateChannel.send(`Ошибка при выполнении запроса в таблице ${tableName}. Проверьте имя таблицы или формат данных.`);
                            return;
                        }

                        if (results.length > 0) {
                            results.forEach(result => {
                                // Конвертируем дату в нужный формат для всех дат, включая ExitDate
                                if (result[dateColumn]) {
                                    result[dateColumn] = moment(result[dateColumn]).format('DD.MM.YYYY HH:mm:ss');
                                }
                                if (result['ExitDate']) {
                                    result['ExitDate'] = moment(result['ExitDate']).format('DD.MM.YYYY HH:mm:ss');
                                }

                                // Форматируем вывод, убирая фигурные скобки и кавычки
                                const formattedResult = JSON.stringify(result, null, 2)
                                    .replace(/[{}]/g, '') // Убираем фигурные скобки
                                    .replace(/"/g, ''); // Убираем кавычки

                                const embed = new EmbedBuilder()
                                    .setTitle(`Логи из таблицы: ${tableName}`)
                                    .setDescription(formattedResult)
                                    .setColor(tableColors[tableName] || '#3498db'); // Используем цвет таблицы, или синий по умолчанию

                                privateChannel.send({ embeds: [embed] });
                            });
                        } else {
                            privateChannel.send(`Нет данных в таблице ${tableName} для заданных критериев.`);
                        }

                        // После выполнения всех запросов добавляем кнопку для удаления канала
                        if (table === tables[tables.length - 1]) {
                            const deleteButton = new ButtonBuilder()
                                .setCustomId('delete_channel')
                                .setLabel('Удалить канал')
                                .setStyle('Danger');

                            const actionRow = new ActionRowBuilder().addComponents(deleteButton);

                            await privateChannel.send({ content: 'Завершено. Нажмите кнопку ниже, чтобы удалить этот канал.', components: [actionRow] });
                        }
                    }
                );
            });
        }
    }

    if (interaction.isButton() && interaction.customId === 'delete_channel') {
        const roleId = '1270506438292406373'; // Замените на ID вашей роли

        if (!interaction.member.roles.cache.has(roleId)) {
            await interaction.reply({ content: 'У вас нет прав на удаление этого канала.', ephemeral: true });
            return;
        }

        const channel = interaction.channel;
        await channel.delete();
    }
});

client.login('');
