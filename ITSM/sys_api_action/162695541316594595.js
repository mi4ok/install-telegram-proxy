/*global  TgBot: readonly, TgBotAuthorization: readonly, CreateStepService: readonly*/
ss.importIncludeScript('TgBotAuthorization');
ss.importIncludeScript('TgBot');
ss.importIncludeScript('CreateStepService');

(function(request, response) {
    try {
        const requestBody = request.getBody();
        ss.info(`[TgWebhook] incoming: ${JSON.stringify(requestBody).substring(0, 500)}`);

        if (requestBody.hasOwnProperty('edited_message')) {
            return;
        }

        if (requestBody.hasOwnProperty('callback_query')) {
            ss.info(`[TgWebhook] callback_query.data: ${requestBody.callback_query.data}`);
        }

        const tgBot = new TgBot('for_client', requestBody);
        ss.info(`[TgWebhook] TgBot created, chatId: ${tgBot.getChatId()}`);

        const tgBotAuthorization = new TgBotAuthorization(tgBot);
        ss.info('[TgWebhook] checking authorization');

        if (!tgBotAuthorization.isAuthorized()) {
            ss.info(`[TgWebhook] not authorized, chatId: ${tgBot.getChatId()}`);
            return;
        }

        ss.info('[TgWebhook] authorized, creating step');
        const createStepService = new CreateStepService(tgBot);
        const step = createStepService.create(tgBot);
        const canRun = step.canRun(tgBot);
        ss.info(`[TgWebhook] step created, canRun: ${canRun}`);

        if (canRun) {
            step.run(tgBot);
            ss.info('[TgWebhook] step.run completed');
        }
    } catch (error) {
        ss.error(`[TgWebhook] EXCEPTION: ${error.message || error}`);
        ss.error(`[TgWebhook] stack: ${error.stack || 'no stack'}`);
    }
})(SimpleApiRequest, SimpleApiResponse);
