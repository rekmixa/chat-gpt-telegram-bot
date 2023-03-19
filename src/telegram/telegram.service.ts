import { Logger, Injectable } from '@nestjs/common'
import { Configuration, OpenAIApi } from 'openai'
import { ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum } from 'openai/dist/api'
import { convertTimeZone } from 'src/helpers'
import * as TelegramBot from 'telegram-bot-api'

@Injectable()
export class TelegramService {
  private logger: Logger = new Logger('TelegramService')
  private readonly bot: TelegramBot

  private chatContexts: { [chatId: string]: { loading: boolean, date: Date, questions: string[] } } = {}

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

        if (this.chatContexts[message.chat.id]?.loading) {
          await this.bot.sendMessage({
            chat_id: message.chat.id,
            text: 'Подожди пока закончится обработка предыдущего вопроса...',
          })

          return
        }

        if (message.text === '/start') {
          await this.replyWithChatGpt(message.chat.id, 'ответь шуточно на тему того, что я не умею дебажить', 'user', false)

          return
        }

        await this.replyWithChatGpt(message.chat.id, message.text)
      } catch (error) {
        if (this.chatContexts[message.chat.id]) {
          this.chatContexts[message.chat.id].loading = false
        }

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

  private async replyWithChatGpt(chatId: string, question: string, role: ChatCompletionRequestMessageRoleEnum = 'assistant', withContext: boolean = true): Promise<void> {
    const openai = new OpenAIApi(new Configuration({
      organization: process.env.OPENAI_ORGANIZATION_ID,
      apiKey: process.env.OPENAI_API_KEY,
    }))

    const messages = withContext === true ? this.getContext(chatId, question) : []

    messages.push({
      role: 'user',
      content: question,
    })

    this.logger.log('Context size: ' + messages.length)

    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages,
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

    if (withContext === true) {
      this.addToContext(chatId, question)
    }
  }

  private getContext(chatId: string, question: string): ChatCompletionRequestMessage[] {
    if (this.chatContexts[chatId] === undefined) {
      this.chatContexts[chatId] = {
        loading: true,
        date: new Date(),
        questions: []
      }
    }

    this.chatContexts[chatId].loading = true

    // Забываем контекст беседы, если не было сообщений в течение часа
    if (this.chatContexts[chatId].date.getTime() < new Date().getTime() - 15 * 1000) {
      this.chatContexts[chatId].questions = []
    }

    const currentContext = []
    for (const question of this.chatContexts[chatId].questions) {
      currentContext.push({
        role: 'system',
        content: question,
      })
    }

    return currentContext
  }

  private addToContext(chatId: string, question: string): void {
    if (this.chatContexts[chatId]) {
      this.chatContexts[chatId].loading = false
      this.chatContexts[chatId].date = new Date()
      this.chatContexts[chatId].questions.push(question)
    }
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
