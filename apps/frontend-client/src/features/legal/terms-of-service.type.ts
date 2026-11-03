import { type LegalDocumentsType, legalUpdatedOn } from './legal-document.type.js';

export const termsOfService: LegalDocumentsType = {
  en: {
    title: 'Terms of Service',
    updated: `Last updated: ${legalUpdatedOn}`,
    sections: [
      {
        heading: 'Agreement',
        paragraphs: [
          'These terms apply to your use of Нищебродская (a price tracker) at aleksei.undo.it, the service. By creating an account or using the service you agree to them. If you do not agree, do not use the service.',
        ],
      },
      {
        heading: 'What the service does',
        paragraphs: [
          'The service reads the public pages of products on supported marketplaces (at present, ozon.ru, dns-shop.ru, wildberries.ru and citilink.ru) and shows you their prices over time. It is a personal project, offered for personal, non-commercial use.',
        ],
      },
      {
        heading: 'Prices are not guaranteed',
        paragraphs: [
          'The prices, availability and pictures are read automatically and may be late, incomplete or wrong, for example when a marketplace changes its page, shows a price that depends on a card or a region, or blocks a read. Check the price on the marketplace before you buy. We are not responsible for purchases you make on the basis of what the service shows.',
        ],
      },
      {
        heading: 'Your account',
        paragraphs: [
          'Give a real email address, keep your login details to yourself and tell us if you suspect that someone else uses your account. You are responsible for what is done with your account.',
        ],
      },
      {
        heading: 'Acceptable use',
        paragraphs: [
          'Do not misuse the service: do not try to break, overload or bypass its limits (there are limits on the number of products and on how fast you can add them), do not use it to collect data in bulk, do not use it for anything unlawful, and do not try to reach the accounts or data of other people.',
        ],
      },
      {
        heading: 'Third parties',
        paragraphs: [
          'The service is not affiliated with, endorsed by or sponsored by Ozon, Google or GitHub. Their names and the content of their pages belong to them, and their own terms apply to your use of them.',
        ],
      },
      {
        heading: 'No warranty',
        paragraphs: [
          'The service is provided "as is" and "as available", without warranties of any kind. It may be unavailable, change or stop at any time.',
        ],
      },
      {
        heading: 'Limitation of liability',
        paragraphs: [
          'To the extent the law allows, we are not liable for any indirect loss or for any loss that comes from the use of the service or from not being able to use it, including from a wrong or late price.',
        ],
      },
      {
        heading: 'Ending',
        paragraphs: [
          'You can stop using the service at any time. We may suspend or delete an account that breaks these terms or abuses the service.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: [
          'We may change these terms; the date above tells when they were last changed. If you keep using the service after a change, you accept the new terms.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [
          'For questions about these terms, contact the administrator of the service. The way to reach them is given in the consent screen of the login through Google, and on the page of the service where you got this link.',
        ],
      },
    ],
  },
  ru: {
    title: 'Условия использования',
    updated: `Обновлено: ${legalUpdatedOn}`,
    sections: [
      {
        heading: 'Соглашение',
        paragraphs: [
          'Эти условия распространяются на использование Нищебродской (трекера цен) на aleksei.undo.it, сервиса. Создавая аккаунт или пользуясь сервисом, вы с ними соглашаетесь. Если не согласны, не пользуйтесь сервисом.',
        ],
      },
      {
        heading: 'Что делает сервис',
        paragraphs: [
          'Сервис читает публичные страницы товаров на поддерживаемых маркетплейсах (сейчас ozon.ru, dns-shop.ru, wildberries.ru и citilink.ru) и показывает, как менялись их цены. Это личный проект, предлагаемый для личного некоммерческого использования.',
        ],
      },
      {
        heading: 'Цены не гарантируются',
        paragraphs: [
          'Цены, наличие и картинки читаются автоматически и могут опаздывать, быть неполными или неверными, например когда маркетплейс меняет страницу, показывает цену, зависящую от карты или региона, или блокирует чтение. Перед покупкой проверяйте цену на маркетплейсе. Мы не отвечаем за покупки, сделанные на основании того, что показывает сервис.',
        ],
      },
      {
        heading: 'Ваш аккаунт',
        paragraphs: [
          'Указывайте настоящий адрес электронной почты, не передавайте данные для входа другим и сообщите нам, если подозреваете, что вашим аккаунтом пользуется кто-то ещё. Вы отвечаете за то, что делается с вашим аккаунтом.',
        ],
      },
      {
        heading: 'Допустимое использование',
        paragraphs: [
          'Не злоупотребляйте сервисом: не пытайтесь его сломать, перегрузить или обойти его ограничения (есть лимиты на число товаров и на скорость их добавления), не используйте его для массового сбора данных, для незаконных целей и не пытайтесь получить доступ к аккаунтам и данным других людей.',
        ],
      },
      {
        heading: 'Третьи стороны',
        paragraphs: [
          'Сервис не связан с Ozon, Google и GitHub, не одобрен и не спонсируется ими. Их названия и содержимое их страниц принадлежат им, а на ваше использование их продуктов распространяются их собственные условия.',
        ],
      },
      {
        heading: 'Без гарантий',
        paragraphs: [
          'Сервис предоставляется «как есть» и «по мере доступности», без каких-либо гарантий. Он может быть недоступен, измениться или прекратить работу в любое время.',
        ],
      },
      {
        heading: 'Ограничение ответственности',
        paragraphs: [
          'В той мере, в какой это разрешает закон, мы не отвечаем за косвенные убытки и за любые потери, возникшие из-за использования сервиса или невозможности им пользоваться, в том числе из-за неверной или запоздавшей цены.',
        ],
      },
      {
        heading: 'Прекращение',
        paragraphs: [
          'Вы можете перестать пользоваться сервисом в любое время. Мы можем приостановить или удалить аккаунт, нарушающий эти условия или злоупотребляющий сервисом.',
        ],
      },
      {
        heading: 'Изменения',
        paragraphs: [
          'Мы можем менять эти условия; дата выше показывает, когда их меняли в последний раз. Если вы продолжаете пользоваться сервисом после изменения, вы принимаете новые условия.',
        ],
      },
      {
        heading: 'Контакты',
        paragraphs: [
          'По вопросам об этих условиях обращайтесь к администратору сервиса. Как с ним связаться, указано на экране согласия при входе через Google и на странице сервиса, откуда вы перешли по этой ссылке.',
        ],
      },
    ],
  },
};
