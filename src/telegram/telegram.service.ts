import { Injectable, Logger } from '@nestjs/common'
import * as TelegramBot from 'node-telegram-bot-api'
import { Configuration, OpenAIApi } from 'openai'
import { ChatCompletionRequestMessage } from 'openai/dist/api'
import { convertTimeZone } from 'src/helpers'

interface ChatContexts {
  [chatId: string]: ChatContext
}

interface ChatContext {
  loading: boolean,
  date: Date,
  messages: ChatCompletionRequestMessage[]
  failedMessage?: any,
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
    this.bot.setMyCommands([
      {
        command: 'start',
        description: 'Запуск',
      },
      {
        command: 'clear_context',
        description: 'Забыть контекст разговора',
      },
      {
        command: 'ping',
        description: 'Пинг',
      },
    ])

    this.bot.on('callback_query', async data => {
      try {
        if (data.data === 'retry') {
          this.logger.log('Retrying...')

          await this.bot.editMessageReplyMarkup({}, {
            chat_id: data.message.chat.id,
            message_id: data.message.message_id,
          })

          await this.bot.answerCallbackQuery(data.id, {
            text: 'Повторная попытка запроса...',
          })

          const context = this.getContext(data.from.id)
          if (context.failedMessage !== undefined) {
            this.handleMessage(context.failedMessage)
          }
        }
      } catch (error) {
        this.logger.debug(error)
      }
    })

    this.bot.on('message', async message => {
      this.handleMessage(message)
    })
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message?.text) {
      return
    }

    try {
      await this.setTyping(message.chat.id)

      if (message.text === '/ping') {
        await this.reply(message.chat.id, 'pong')

        return
      }

      if (this.isLoading(message.chat.id) === true) {
        await this.reply(message.chat.id, 'Подождите пока закончится обработка предыдущего запроса...')

        return
      }

      if (this.isOnWork() === false) {
        await this.reply(message.chat.id, 'Пишите мне только в рабочее время')

        return
      }

      if (message.text === '/clear_context') {
        let responseMessage = 'Контекст успешно очищен'
        if (this.clearContext(message.chat.id) === false) {
          responseMessage = 'Контекст пуст'
        }

        await this.reply(message.chat.id, responseMessage)

        return
      }

      if (message.text === '/start') {
        await this.replyWithChatGpt(message.chat.id, 'ответь шуточно на тему того, что я не умею дебажить', false)

        return
      }

      await this.replyWithChatGpt(message.chat.id, message.text)
    } catch (error) {
      const context = this.getContext(message.chat.id)
      context.failedMessage = message

      this.logger.debug(error)

      try {
        await this.reply(message.chat.id, 'Что-то пошло не так...', {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Попробовать снова',
                  callback_data: 'retry',
                }
              ],
            ],
          }
        })
      } catch (error) {
        this.logger.debug(error)
      }
    } finally {
      this.setLoading(message.chat.id, false)
    }
  }

  private async setTyping(chatId): Promise<void> {
    this.logger.log(`Typing started for: ${chatId}`)
    await this.bot.sendChatAction(chatId, 'typing')

    if (this.isLoading(chatId) === false) {
      const interval = setInterval(async () => {
        if (this.isLoading(chatId) === false) {
          this.logger.log(`Typing finished for: ${chatId}`)
          clearInterval(interval)

          return
        }

        await this.bot.sendChatAction(chatId, 'typing')
      }, 1000)
    }
  }

  private async reply(chatId: string, text: string, options?: any): Promise<void> {
    await this.bot.sendMessage(chatId, text, options)
  }

  private async replyWithChatGpt(chatId: string, question: string, withContext: boolean = true): Promise<void> {
    this.setLoading(chatId, true)
    const openai = new OpenAIApi(new Configuration({
      organization: process.env.OPENAI_ORGANIZATION_ID,
      apiKey: process.env.OPENAI_API_KEY,
    }))

    const context = withContext === true ? this.getContextMessages(chatId) : []
    const systemMessages = context.filter(message => message.role === 'system')
    const userMessage: ChatCompletionRequestMessage = {
      role: 'user',
      content: question,
    }

    this.logger.log(`Context size: ${context.length}, System messages: ${systemMessages.length}`)

    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        ...context,
        userMessage,
      ],
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
      await this.reply(chatId, message.content)

      if (withContext === true) {
        this.addToContext(chatId, message)
      }
    }
  }

  private getContext(chatId: string): ChatContext {
    if (this.chatContexts[chatId] === undefined) {
      this.chatContexts[chatId] = {
        loading: false,
        date: new Date(),
        messages: []
      }
    }

    return this.chatContexts[chatId]
  }

  private getContextMessages(chatId: string): ChatCompletionRequestMessage[] {
    const context = this.getContext(chatId)

    // Забываем контекст беседы, если не было сообщений в течение 15 минут
    if (context.date.getTime() < new Date().getTime() - 900 * 1000) {
      context.messages = []
    }

    const currentContext = []

    currentContext.push({
      role: 'system',
      content: 'на вопросы, не связанные с it говори, что не можешь ответить и выдавай короткий анекдот про php',
    })

    currentContext.push({
      role: 'system',
      content: 'Меня зовут МишаБОТ',
    })

    for (const message of context.messages) {
      currentContext.push(message)
    }

    return currentContext
  }

  private addToContext(chatId: string, message: ChatCompletionRequestMessage): void {
    this.setLoading(chatId, false)
    const context = this.getContext(chatId)
    context.date = new Date()
    context.messages.push(message)
  }

  private clearContext(chatId: string): boolean {
    if (this.chatContexts[chatId] === undefined) {
      return false
    }

    delete this.chatContexts[chatId]
    this.logger.log(`Clearing context for: ${chatId}`)

    return true
  }

  private isLoading(chatId: string): boolean {
    const context = this.getContext(chatId)

    return context.loading
  }

  private setLoading(chatId: string, loading: boolean): void {
    const context = this.getContext(chatId)
    context.loading = loading
  }

  private isOnWork(): boolean {
    if (process.env.NODE_ENV === 'development') {
      return true
    }

    const date = convertTimeZone(new Date(), process.env.TIMEZONE)

    if (date.getDay() === 0 || date.getDay() === 6) {
      return false
    }

    return date.getHours() >= 8 && date.getHours() <= 19
  }
}
