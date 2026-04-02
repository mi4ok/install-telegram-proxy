(async () => {
    if (!ss.hasRole('admin')) {
        return ss.setRedirect('/403');
    }

    const { action } = input;

    if (action === 'INIT') {
        data.botUrl = ss.getProperty('vcsm.telegram_bot.url');
        data.slug = getSlug();
        data.instanseUri = getInstanseUri();
        data.webhookBaseUrl = ss.getProperty('vcsm.telegram_bot.webhook_url') || data.instanseUri;
        data.botsData = await getTgBotsData();
        data.translations = getTranslations();
        data.isEnglish = ss.getUser().getDisplayValue('language_id') === 'English';
    }

    if (action === 'DISCONNECT') {
        if (!(await disconnect(input.botsData[input.botName]))) {
            return;
        }

        changeConnectionActive(false, input.botsData[input.botName]);

        input.botsData[input.botName].state = false;
        data.botsData = input.botsData;
        data.action = '';
        data.botName = '';
        ss.addSuccessMessage(input.translations.connectionIsDisabled);
    }

    if (action === 'CONNECTED') {
        if (!(await connected(input.botsData[input.botName]))) {
            ss.addErrorMessage(input.translations.connectionFailed);
            return (data.isConnected = false);
        }

        const isConnectionExist = input.botsData[input.botName].connection_id;

        if (!isConnectionExist) {
            const connectionId = await createConnection(input.token, input.endpoint, input.botsData[input.botName].id);
            input.botsData[input.botName].connection_id = connectionId;
        }

        changeConnectionActive(true, input.botsData[input.botName]);

        const isConnectionChange = (
            input.botsData[input.botName].token !== input.token
            || input.botsData[input.botName].endpoint.database_value !== input.endpoint.database_value
        );

        if (isConnectionChange) {
            updateConnection(input.token, input.endpoint, input.botsData[input.botName]);
        }

        if (!isConnectionExist || isConnectionChange) {
            input.botsData[input.botName].token = input.token;
            input.botsData[input.botName].endpoint = input.endpoint;
        }

        ss.addSuccessMessage(input.translations.messageConnected);
        input.botsData[input.botName].state = true;
        data.isConnected = true;
        data.botsData = input.botsData;
        data.action = '';
        data.botName = '';
    }
})();

function getSlug() {
    const VCSM = '171932070318122116';
    const application = new SimpleRecord('sys_application');
    application.get(VCSM);
    return application.slug;
}

function getInstanseUri() {
    const propertyValue = ss.getProperty('simple.instance.uri');
    return propertyValue.includes('https://') || propertyValue.includes('http://')
        ? propertyValue
        : `https://${propertyValue}`;
}

async function getTgBotsData() {
    const botsData = {};
    const tgBots = getTgBots();
    const tgBotConnectionsAttributes = getTgBotConnectionsAttributes(tgBots);
    const apiActionsAttributes = getApiActionsAttributes(tgBots, tgBotConnectionsAttributes);
    const modulesAttributes = getModulesAttributes(apiActionsAttributes);
    const versionsAttributes = getVersionsAttributes(apiActionsAttributes);

    for (const botName in tgBots) {
        const hasConnection = Object.keys(tgBotConnectionsAttributes).includes(botName);
        const endpointId = hasConnection
            ? tgBotConnectionsAttributes[botName].endpoint.database_value
            : tgBots[botName].default_endpoint.database_value;
        botsData[botName] = {
            ...tgBots[botName],
            ...tgBotConnectionsAttributes[botName],
            ...apiActionsAttributes[endpointId],
            ...modulesAttributes[apiActionsAttributes[endpointId].module_id],
            ...versionsAttributes[apiActionsAttributes[endpointId].version_id],
        };
        //eslint-disable-next-line no-await-in-loop
        botsData[botName].state = hasConnection ? await check(botsData[botName]) : false;
    }

    return botsData;
}

function getTranslations() {
    const sm = new SimpleMessage();
    return {
        officialDocumentation: sm.getMessage('(VCSM) Telegram official documentation'),
        moreInformation: sm.getMessage('(VCSM) For more information about naming rules and other guidelines'),
        createNewBot: sm.getMessage('(VCSM) Create a new bot'),
        tokenExample: sm.getMessage('(VCSM) A token example'),
        method: sm.getMessage('(VCSM) method'),
        sendMessageToBotFather: sm.getMessage('(VCSM) Send the /newbot message to @BotFather'),
        giveNameToBot: sm.getMessage('(VCSM) Give a name and a username to the bot.'),
        changeOrCreateEndpoint: sm.getMessage('(VCSM) If needed, change or create endpoint'),
        anEndpoint: sm.getMessage('(VCSM) an endpoint'),
        linkToWebhookMethod: sm.getMessage('(VCSM) Link to webhook method'),
        token: sm.getMessage('(VCSM) Token'),
        endpoint: sm.getMessage('(VCSM) Endpoint'),
        copyAndPasteToken: sm.getMessage('(VCSM) Copy and paste token'),
        telegramBotConnection: sm.getMessage('(VCSM) Telegram bot connection'),
        chooseBotType: sm.getMessage('(VCSM) Choose the bot type'),
        connectedBots: sm.getMessage('(VCSM) Connected bots'),
        disconnectedBots: sm.getMessage('(VCSM) Disconnected bots'),
        youCanDisableConnection: sm.getMessage('(VCSM) You can disable the bot connection.'),
        deleteConnection: sm.getMessage('(VCSM) Delete the connection'),
        connectionIsDisabled: sm.getMessage('(VCSM) The connection is disabled'),
        connectionFailed: sm.getMessage('(VCSM) Connection failed'),
        messageConnected: sm.getMessage('(VCSM) Info message Connected'),
        buttonSet: sm.getMessage('(VCSM) button set'),
        step: sm.getMessage('(VCSM) Step'),
        info: sm.getMessage('(VCSM) info tgBot'),
        linkCreatedNewEndpoint: sm.getMessage('(VCSM) Link created new endpoint'),
        newEndpoint: sm.getMessage('(VCSM) New endpoint'),
        save: sm.getMessage('Save'),
        disable: sm.getMessage('(VCSM) Disable tgBot'),
    };
}

async function disconnect(tgBotAttributes) {
    return request(`${input.botUrl}/bot${tgBotAttributes.token}/setWebhook`, {}).ok;
}

async function connected(tgBotAttributes) {
    const webhookBase = input.webhookBaseUrl || input.instanseUri;
    const webhookUrl = getRestApiUrlByAction(tgBotAttributes, webhookBase, input.slug);
    const result = request(
        `${input.botUrl}/bot${input.token}/setWebhook?url=${webhookUrl}`,
        { method: 'POST' },
    );
    if (!result.ok) {
        ss.error(`Telegram setWebhook failed: ${JSON.stringify(result)}, webhookUrl: ${webhookUrl}`);
    }
    return result.ok;
}

async function createConnection(token, endpoint, botId) {
    const record = new SimpleRecord('vcsm_telegram_bot_connection');
    record.bot = botId;
    record.token = token;
    record.endpoint = endpoint.database_value;
    record.bot_username = await getBotUserName(token);
    const recordId = record.insert();

    if (recordId === '0') {
        ss.error(record.getErrors());
    }

    return recordId;
}

function updateConnection(token, endpoint, tgBotAttributes) {
    const record = new SimpleRecord('vcsm_telegram_bot_connection');
    record.get(tgBotAttributes.connection_id);
    record.token = token;
    record.endpoint = endpoint.database_value;

    if (record.update() === '0') {
        ss.error(record.getErrors());
    }
}

function changeConnectionActive(active, tgBotAttributes) {
    const record = new SimpleRecord('vcsm_telegram_bot_connection');
    record.get(tgBotAttributes.connection_id);
    record.active = active;

    if (record.update() === '0') {
        ss.error(record.getErrors());
    }
}

function getTgBots() {
    const tgBots = {};
    const record = new SimpleRecord('vcsm_telegram_bot');
    record.selectAttributes(['bot_system_name', 'bot_name', 'default_endpoint', 'sys_id']);
    record.query();

    while (record.next()) {
        tgBots[record.bot_system_name] = {
            name: record.bot_system_name,
            title: record.bot_name,
            id: record.sys_id,
            default_endpoint: {
                database_value: record.getValue('default_endpoint'),
                display_value: record.getDisplayValue('default_endpoint'),
            },
        };
    }

    return tgBots;
}

function getTgBotConnectionsAttributes(tgBots) {
    const connnectionsAttributes = {};
    const botIds = [];

    for (const botName in tgBots) {
        botIds.push(tgBots[botName].id);
    }

    const record = new SimpleRecord('vcsm_telegram_bot_connection');
    record.addQuery('bot', 'IN', botIds);
    record.selectAttributes(['bot', 'sys_id', 'endpoint', 'token', 'bot_username']);
    record.query();

    while (record.next()) {
        connnectionsAttributes[record.bot.getValue('bot_system_name')] = {
            token: record.token,
            connection_id: record.sys_id,
            bot_username: record.bot_username,
            endpoint: {
                database_value: record.getValue('endpoint'),
                display_value: record.getDisplayValue('endpoint'),
            },
        };
    }

    return connnectionsAttributes;
}

function getApiActionsAttributes(tgBots, tgBotConnectionsAttributes) {
    const apiActionsAttributes = {};
    const endpointIds = [];
    const connectionBotNames = Object.keys(tgBotConnectionsAttributes);

    for (const botName in tgBots) {
        connectionBotNames.includes(botName)
            ? endpointIds.push(tgBotConnectionsAttributes[botName].endpoint.database_value)
            : endpointIds.push(tgBots[botName].default_endpoint.database_value);
    }

    const record = new SimpleRecord('sys_api_action');
    record.addQuery('sys_id', 'IN', endpointIds);
    record.selectAttributes(['name', 'sys_id', 'path', 'module_id', 'version_id']);
    record.query();

    while (record.next()) {
        apiActionsAttributes[record.sys_id] = {
            api_action_name: record.name,
            api_action_path: record.path,
            module_id: record.getValue('module_id'),
            version_id: record.getValue('version_id'),
        };
    }

    return apiActionsAttributes;
}

function getModulesAttributes(apiActionsAttributes) {
    const modulesAttributes = {};
    const moduleIds = [];

    for (const id in apiActionsAttributes) {
        if (!moduleIds.includes(apiActionsAttributes[id].module_id)) {
            moduleIds.push(apiActionsAttributes[id].module_id);
        }
    }

    const record = new SimpleRecord('sys_api_module');
    record.addQuery('sys_id', 'IN', moduleIds);
    record.selectAttributes(['sys_id', 'path']);
    record.query();

    while (record.next()) {
        modulesAttributes[record.sys_id] = {
            module_path: record.path,
        };
    }

    return modulesAttributes;
}

function getVersionsAttributes(apiActionsAttributes) {
    const versionsAttributes = {};
    const versionIds = [];

    for (const id in apiActionsAttributes) {
        if (!versionIds.includes(apiActionsAttributes[id].version_id)) {
            versionIds.push(apiActionsAttributes[id].version_id);
        }
    }

    const record = new SimpleRecord('sys_api_version');
    record.addQuery('sys_id', 'IN', versionIds);
    record.selectAttributes(['sys_id', 'path']);
    record.query();

    while (record.next()) {
        versionsAttributes[record.sys_id] = {
            version_path: record.path,
        };
    }

    return versionsAttributes;
}

async function check(tgBotAttributes) {
    try {
        const url = `${data.botUrl}/bot${tgBotAttributes.token}/getWebhookInfo`;
        ss.info(`[TgProxy] check: requesting ${url}`);
        const response = request(url, { methodGetWebhookInfo: 'POST' });
        ss.info(`[TgProxy] check: response = ${JSON.stringify(response)}`);
        if (!response.ok || !response.result) {
            ss.info('[TgProxy] check: response not ok');
            return false;
        }
        const webhookBase = data.webhookBaseUrl || data.instanseUri;
        const expectedUrl = getRestApiUrlByAction(tgBotAttributes, webhookBase, data.slug);
        const directUrl = getRestApiUrlByAction(tgBotAttributes, data.instanseUri, data.slug);
        const currentUrl = response.result.url;
        ss.info(`[TgProxy] check: current=${currentUrl}, expected=${expectedUrl}, direct=${directUrl}`);
        return currentUrl === expectedUrl || currentUrl === directUrl;
    } catch (error) {
        ss.error(`[TgProxy] check error: ${error.message || error}`);
        return false;
    }
}

function getRestApiUrlByAction(tgBotAttributes, instanseUri, slug) {
    return [
        instanseUri,
        'v1',
        'api',
        slug,
        tgBotAttributes.module_path,
        tgBotAttributes.version_path,
        tgBotAttributes.api_action_path,
    ].join('/');
}

function request(url, body) {
    ss.info(`[TgProxy] request: ${url}`);
    const newRequest = sws.restRequestV1();
    newRequest.setRequestUrl(url);
    newRequest.setRequestMethod('POST');
    newRequest.setRequestHeader('Content-Type', 'application/json');
    newRequest.setRequestBody(JSON.stringify(body));
    const response = newRequest.execute();
    const responseBody = response.getBody();
    ss.info(`[TgProxy] response status: ${response.getStatusCode()}, body: ${responseBody}`);
    return JSON.parse(responseBody);
}

async function getBotUserName(token) {
    return request(`${input.botUrl}/bot${token}/getMe`, {
        methodGetWebhookInfo: 'POST',
    }).result.username;
}
