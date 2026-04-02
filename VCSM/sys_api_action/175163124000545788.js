/*global TgBot, InitStep, CommentStep, ViewApprovalsListStep, CommentOnRejectApprovalStep, ApprovalStep, TgBotParseHelper, GoToApprovalStep, StepStorage, TgBotAuthorization, CreateStepService: readonly*/
ss.importIncludeScript('VCSMTgBotAuthorization');
ss.importIncludeScript('VCSMTgBot');
ss.importIncludeScript('VCSMInitStep');
ss.importIncludeScript('VCSMApprovalStep');
ss.importIncludeScript('VCSMStepStorage');
ss.importIncludeScript('VCSMCommentStep');
ss.importIncludeScript('VCSMGoToApprovalStep');
ss.importIncludeScript('VCSMCommentOnRejectApprovalStep');
ss.importIncludeScript('VCSMViewApprovalsListStep');

(function(request, response) {
    try {
        const requestBody = request.getBody();
        ss.info(`[VCSMWebhook] incoming: ${JSON.stringify(requestBody).substring(0, 500)}`);

        if (requestBody.hasOwnProperty('edited_message')) {
            return;
        }

        if (requestBody.hasOwnProperty('callback_query')) {
            ss.info(`[VCSMWebhook] callback_query.data: ${requestBody.callback_query.data}`);
        }

        const tgBot = new TgBot('vcsm_for_client', requestBody);
        ss.info(`[VCSMWebhook] TgBot created, chatId: ${tgBot.getChatId()}`);

        const tgBotAuthorization = new TgBotAuthorization(tgBot);

        if (!tgBotAuthorization.isAuthorized()) {
            ss.info(`[VCSMWebhook] not authorized, chatId: ${tgBot.getChatId()}`);
            return;
        }

        ss.info('[VCSMWebhook] authorized, creating step');
        const step = create(tgBot);
        const canRun = step.canRun(tgBot);
        ss.info(`[VCSMWebhook] step created, canRun: ${canRun}`);

        if (canRun) {
            step.run(tgBot);
            ss.info('[VCSMWebhook] step.run completed');
        }
    } catch (error) {
        ss.error(`[VCSMWebhook] EXCEPTION: ${error.message || error}`);
        ss.error(`[VCSMWebhook] stack: ${error.stack || 'no stack'}`);
    }
})(SimpleApiRequest, SimpleApiResponse);

function create(tgBot) {
    const stepRegistry = {
        init: InitStep,
        approval: ApprovalStep,
        comment: CommentStep,
        comment_on_reject_approval: CommentOnRejectApprovalStep,
        view_approvals_list: ViewApprovalsListStep,
    };

    if (tgBot.isRequestBodyHasCallbackQuery() && TgBotParseHelper.parseCommand(tgBot.getDataFromCallbackQuery()) === 'go_to_approval') {
        return new GoToApprovalStep();
    }

    const stepStorage = new StepStorage();
    const step = stepStorage.getStep(tgBot.getChatId());
    return new stepRegistry[step]();
}
