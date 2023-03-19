import { Logger, Injectable } from '@nestjs/common'
import { Configuration, OpenAIApi } from 'openai'
import { ChatCompletionRequestMessageRoleEnum } from 'openai/dist/api'
import { convertTimeZone } from 'src/helpers'
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
      if (!message?.text) {
        return
      }

      this.logger.log(`@${message.from.username}: ${message.text}`)

      try {
        await this.bot.sendChatAction({
          chat_id: message.chat.id,
          action: 'typing',
        })

        if (message.text === '/ping') {
          await this.bot.sendMessage({
            chat_id: message.chat.id,
            text: 'pong',
          })

          return
        }

        if (this.nowIsWeekend() === true) {
          await this.bot.sendMessage({
            chat_id: message.chat.id,
            text: 'У меня выходной, давай с этим в понедельник или иди в гугл',
          })

          return
        }

        if (this.isNotWorkingTime() === true) {
          await this.bot.sendMessage({
            chat_id: message.chat.id,
            text: 'Пиши только в рабочее время. Думаешь, мне заняться больше нечем?!',
          })

          return
        }

        if (message.text === '/start') {
          await this.replyWithChatGpt(message.chat.id, 'ответь шуточно на тему того, что я не умею дебажить', 'user')

          return
        }

        await this.replyWithChatGpt(message.chat.id, message.text)
      } catch (error) {
        this.logger.debug(error)

        if (error.response) {
          this.logger.warn(error.response.data.error.message)
        }

        try {
          await this.bot.sendMessage({
            chat_id: message.chat.id,
            text: 'Something went wrong',
          })
        } catch (error) {
          this.logger.debug(error)
        }
      }
    })
  }

  private async replyWithChatGpt(chatId: string, question: string, role: ChatCompletionRequestMessageRoleEnum = 'assistant'): Promise<void> {
    const openai = new OpenAIApi(new Configuration({
      organization: process.env.OPENAI_ORGANIZATION_ID,
      apiKey: process.env.OPENAI_API_KEY,
    }))

    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role,
          content: question,
        }
      ],
    })

    const text = completion.data.choices
      .filter(choice => choice.message !== undefined)
      .map(choice => choice.message.content)
      .join('\n')

    this.logger.log(text)

    await this.bot.sendMessage({
      chat_id: chatId,
      text,
    })
  }

  private isNotWorkingTime(): boolean {
    if (process.env.NODE_ENV === 'development') {
      return false
    }

    const date = convertTimeZone(new Date(), process.env.TIMEZONE)

    return date.getHours() < 9 || date.getHours() > 17
  }

  private nowIsWeekend(): boolean {
    if (process.env.NODE_ENV === 'development') {
      return false
    }

    const date = convertTimeZone(new Date(), process.env.TIMEZONE)

    return date.getDay() === 0 || date.getDay() === 6
  }
}
