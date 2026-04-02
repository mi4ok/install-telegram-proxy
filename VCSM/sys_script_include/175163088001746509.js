/**
 * @typedef TgBot
 * @method getToken()
 * @method sendMessage()
 * @method getChatId()
 * @method getPhoneNumber()
 * @method isRequestContact()
 * @method isRequestBodyHasCallbackQuery()
 * @method isRequestBodyHasSticker()
 * @method isRequestBodyHasCaption()
 * @method isRequestBodyHasText()
 * @method getDataFromCallbackQuery()
 * @method isRequestBodyHasMessage()
 * @method getDataFromCaption()
 * @method getDataFromText()
 * @method getSender()
 * @method __initChatId()
 * @method __setDefaultPOSTRequest()
 * @method __getApiUrl()
 */
//eslint-disable-next-line no-unused-vars
class TgBot {
    /**
     * @constructor
     * @param {string} botName
     * @param {object} requestBody
     * @param {number|null} chatId
     */
    constructor(botName, requestBody, chatId = null) {
        this.requestBody = requestBody;
        this.botName = botName;
        this.chatId = chatId || this.__initChatId();
    }

    /**
     * Get bot token
     * @return {string} bot token
     */
    getToken() {
        const botConnection = new SimpleRecord('vcsm_telegram_bot_connection');
        botConnection.addQuery('bot.bot_system_name', this.botName);
        botConnection.addQuery('active', true);
        botConnection.selectAttributes(['token']);
        botConnection.setLimit(1);
        botConnection.query();

        if (botConnection.next()) {
            return botConnection.token;
        }

        ss.error(`There is no active token. Telegram bot system name: "${this.botName}"`);
        return '';
    }

    /**
     * Send message
     * @param {object} body
     */
    sendMessage(body) {
        body.chat_id = this.getChatId();
        this.__setDefaultPOSTRequest(`${this.__getApiUrl()}/sendMessage`, body);
    }

    /**
     * Get chat ID
     * @returns {number} chatId
     */
    getChatId() {
        return this.chatId;
    }

    /**
     * Get phone number
     * @returns {string} phone number
     */
    getPhoneNumber() {
        return this.requestBody.message.contact.phone_number;
    }

    /**
     * Is contact available
     * @returns {boolean} true or false
     */
    isRequestContact() {
        return this.requestBody.message.hasOwnProperty('contact');
    }

    /**
     * Is request body has property callback_query
     * @returns {boolean} true or false
     */
    isRequestBodyHasCallbackQuery() {
        return this.requestBody.hasOwnProperty('callback_query');
    }

    /**
     * Is request body has property sticker
     * @returns {boolean} true or false
     */
    isRequestBodyHasSticker() {
        return this.requestBody.message.hasOwnProperty('sticker');
    }

    /**
     * Is request body has property caption
     * @returns {boolean} true or false
     */
    isRequestBodyHasCaption() {
        return this.requestBody.message.hasOwnProperty('caption');
    }

    /**
     * Is request body has property text
     * @returns {boolean} true or false
     */
    isRequestBodyHasText() {
        return this.requestBody.message.hasOwnProperty('text');
    }

    /**
     * Is request body has property message
     * @returns {boolean} true or false
     */
    isRequestBodyHasMessage() {
        return this.requestBody.hasOwnProperty('message');
    }

    /**
     * Get value of requestBody.callback_query.data
     * @returns {string} data
     */
    getDataFromCallbackQuery() {
        return this.requestBody.callback_query.data;
    }

    /**
     * Get value of requestBody.message.caption
     * @returns {string} caption
     */
    getDataFromCaption() {
        return this.requestBody.message.caption;
    }

    /**
     * Get value of requestBody.message.text
     * @returns {string} text
     */
    getDataFromText() {
        return this.requestBody.message.text;
    }

    /**
     * Get information about the user who sent the message
     * @returns {object} user information
     */
    getSender() {
        return {
            firstName: this.requestBody.message.from.first_name,
            lastName: this.requestBody.message.from.last_name,
            id: this.requestBody.message.from.id,
        };
    }

    /**
     * initializes the chatId variable
     * @returns {number} chatId
     */
    __initChatId() {
        if (this.requestBody.hasOwnProperty('callback_query')) {
            return this.requestBody.callback_query.message.chat.id;
        }

        if (this.requestBody.hasOwnProperty('my_chat_member')) {
            return this.requestBody.my_chat_member.chat.id;
        }

        return this.requestBody.message.chat.id;
    }

    /**
     * Object creation using REST requests
     * @param {string} url
     * @param {object} body
     */
    __setDefaultPOSTRequest(url, body) {
        ss.info(`[VCSMTgBot] POST ${url}`);
        const newRequest = sws.restRequestV1();
        newRequest.setRequestUrl(url);
        newRequest.setRequestMethod('POST');
        newRequest.setRequestHeader('Content-Type', 'application/json');
        newRequest.setRequestBody(JSON.stringify(body));
        const response = newRequest.execute();
        const status = response.getStatusCode();
        const responseBody = response.getBody();
        if (status !== 200) {
            ss.error(`[VCSMTgBot] POST ${url} failed: status=${status}, body=${responseBody}`);
        } else {
            ss.info(`[VCSMTgBot] POST ${url} ok: ${responseBody}`);
        }
    }

    /**
     * Get Api URL
     * @returns {string} URL
     */
    __getApiUrl() {
        const botUrl = ss.getProperty('vcsm.telegram_bot.url');
        ss.info(`[VCSMTgBot] apiUrl: ${botUrl}/bot${this.getToken()}`);
        return `${botUrl}/bot${this.getToken()}`;
    }
}
