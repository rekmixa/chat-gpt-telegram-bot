import { Injectable, Logger } from '@nestjs/common'
import * as TelegramBot from 'node-telegram-bot-api'
import { Configuration, OpenAIApi } from 'openai'
import { ChatCompletionRequestMessage } from 'openai/dist/api'
import { convertTimeZone } from 'src/helpers'

interface ChatContexts {
  [chatId: string]: {
    loading: boolean,
    date: Date,
    messages: ChatCompletionRequestMessage[]
  }
}

@Injectable()
export class TelegramService {
  private readonly logger: Logger = new Logger('TelegramService')
  private readonly bot: TelegramBot

  private chatContexts: ChatContexts = {}

  constructor() {
    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })
  }

  async onModuleInit() {
    this.bot.on('message', async message => {
      if (!message?.text) {
        return
      }

      this.logger.log(`@${message.from.username}: ${message.text}`)

      try {
        await this.setTyping(message.chat.id)

        if (message.text === '/ping') {
          await this.reply(message.chat.id, 'pong')

          return
        }

        if (this.nowIsWeekend() === true) {
          await this.reply(message.chat.id, 'У меня выходной, давай в понедельник')

          return
        }

        if (this.isNotWorkingTime() === true) {
          await this.reply(message.chat.id, 'Пиши только в рабочее время')

          return
        }

        if (this.isLoading(message.chat.id) === true) {
          await this.reply(message.chat.id, 'Подожди пока закончится обработка предыдущего вопроса...')

          return
        }

        if (message.text === '/start') {
          await this.replyWithChatGpt(message.chat.id, 'ответь шуточно на тему того, что я не умею дебажить', false)

          return
        }

        await this.replyWithChatGpt(message.chat.id, message.text)
      } catch (error) {
        if (this.chatContexts[message.chat.id]) {
          this.chatContexts[message.chat.id].loading = false
        }

        this.logger.debug(error)

        try {
          await this.reply(message.chat.id, 'Что-то пошло не так...')
        } catch (error) {
          this.logger.debug(error)
        }
      }
    })
  }

  private async setTyping(chatId): Promise<void> {
    this.logger.log(`Typing: ${chatId}`)
    await this.bot.sendChatAction(chatId, 'typing')

    if (this.isLoading(chatId) === false) {
      const interval = setInterval(async () => {
        if (this.isLoading(chatId) === false) {
          clearInterval(interval)

          return
        }

        this.logger.log(`Typing: ${chatId}`)
        await this.bot.sendChatAction(chatId, 'typing')
      }, 1000)
    }
  }

  private async reply(chatId: string, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, text)
  }

  private async replyWithChatGpt(chatId: string, question: string, withContext: boolean = true): Promise<void> {
    const openai = new OpenAIApi(new Configuration({
      organization: process.env.OPENAI_ORGANIZATION_ID,
      apiKey: process.env.OPENAI_API_KEY,
    }))

    const messages = withContext === true ? this.getContext(chatId) : []
    const userMessage: ChatCompletionRequestMessage = {
      role: 'user',
      content: question,
    }

    messages.push(userMessage)
    this.logger.log('Context size: ' + messages.length)

    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages,
    })

    const resultMessages = completion.data.choices
      .filter(choice => choice.message !== undefined)
      .map(choice => choice.message)

    if (completion.data.usage !== undefined) {
      this.logger.log(
        Object.entries(completion.data.usage)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')
          .trim()
      )
    }

    if (withContext === true) {
      this.addToContext(chatId, userMessage)
    }

    for (const message of resultMessages) {
      this.logger.log(message.content)

      await this.reply(chatId, message.content)

      if (withContext === true) {
        this.addToContext(chatId, message)
      }
    }
  }

  private getContext(chatId: string): ChatCompletionRequestMessage[] {
    if (this.chatContexts[chatId] === undefined) {
      this.chatContexts[chatId] = {
        loading: true,
        date: new Date(),
        messages: []
      }
    }

    this.chatContexts[chatId].loading = true

    // Забываем контекст беседы, если не было сообщений в течение 15 минут
    if (this.chatContexts[chatId].date.getTime() < new Date().getTime() - 900 * 1000) {
      this.chatContexts[chatId].messages = []
    }

    const currentContext = []

    currentContext.push({
      role: 'system',
      content: 'на вопросы, не связанные с it говори, что не можешь ответить и выдавай короткий анекдот про то что php умирает'
    })

    for (const message of this.chatContexts[chatId].messages) {
      currentContext.push(message)
    }

    return currentContext
  }

  private addToContext(chatId: string, message: ChatCompletionRequestMessage): void {
    if (this.chatContexts[chatId]) {
      this.chatContexts[chatId].loading = false
      this.chatContexts[chatId].date = new Date()
      this.chatContexts[chatId].messages.push(message)
    }
  }

  private isLoading(chatId: string): boolean {
    return Boolean(this.chatContexts[chatId]?.loading)
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
