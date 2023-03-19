import { Logger, Injectable } from '@nestjs/common'
import { Configuration, OpenAIApi } from 'openai'
import { ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum } from 'openai/dist/api'
import { convertTimeZone } from 'src/helpers'
import * as TelegramBot from 'node-telegram-bot-api'

@Injectable()
export class TelegramService {
  private readonly logger: Logger = new Logger('TelegramService')
  private readonly bot: TelegramBot

  private chatContexts: { [chatId: string]: { loading: boolean, date: Date, questions: string[] } } = {}

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
          await this.replyWithChatGpt(message.chat.id, 'ответь шуточно на тему того, что я не умею дебажить', 'user', false)

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

  private async replyWithChatGpt(chatId: string, question: string, role: ChatCompletionRequestMessageRoleEnum = 'assistant', withContext: boolean = true): Promise<void> {
    const openai = new OpenAIApi(new Configuration({
      organization: process.env.OPENAI_ORGANIZATION_ID,
      apiKey: process.env.OPENAI_API_KEY,
    }))

    const messages = withContext === true ? this.getContext(chatId) : []

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

    await this.reply(chatId, text)

    if (withContext === true) {
      this.addToContext(chatId, question)
    }
  }

  private getContext(chatId: string): ChatCompletionRequestMessage[] {
    if (this.chatContexts[chatId] === undefined) {
      this.chatContexts[chatId] = {
        loading: true,
        date: new Date(),
        questions: []
      }
    }

    this.chatContexts[chatId].loading = true

    // Забываем контекст беседы, если не было сообщений в течение 15 минут
    if (this.chatContexts[chatId].date.getTime() < new Date().getTime() - 900 * 1000) {
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
