import { Logger, Injectable } from '@nestjs/common'
import { Configuration, OpenAIApi } from 'openai'
import * as TelegramBot from 'telegram-bot-api'

@Injectable()
export class TelegramService {
  private logger: Logger = new Logger('TelegramService')
  private readonly bot: TelegramBot

  constructor() {
    this.bot = new TelegramBot({
      token: process.env.TELEGRAM_BOT_TOKEN,
    })
  }

  async onModuleInit() {
    const messageProvider = new TelegramBot.GetUpdateMessageProvider()
    this.bot.setMessageProvider(messageProvider)

    this.bot.start()
      .then(() => {
        this.logger.log('BOT is started')
      })
      .catch(error => {
        this.logger.debug(error)
      })

    this.bot.on('update', async ({ message }) => {
      if (!message.text) {
        return
      }

      this.logger.log(`@${message.from.username}: ${message.text}`)

      try {
        await this.bot.sendChatAction({
          chat_id: message.chat.id,
          action: 'typing',
        })

        const openai = new OpenAIApi(new Configuration({
          organization: process.env.OPENAI_ORGANIZATION_ID,
          apiKey: process.env.OPENAI_API_KEY,
        }))

        const completion = await openai.createCompletion({
          // model: 'gpt-3.5-turbo',
          model: 'code-davinci-002',
          prompt: message.text,
          max_tokens: 1000,
        })

        const text = completion.data.choices
          .map(choice => choice.text)
          .join('\n')

        this.logger.log(text)

        await this.bot.sendMessage({
          chat_id: message.chat.id,
          text,
        })
      } catch (error) {
        this.logger.debug(error)

        if (error.response) {
          this.logger.warn(error.response.data.error.message)
        }
      }
    })
  }
}
