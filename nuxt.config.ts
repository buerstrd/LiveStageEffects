// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/styles/m3.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'zh-CN',
        class: 'dark'
      },
      meta: [
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#181a1f' }
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&display=swap'
        }
      ]
    }
  },
  hooks: {
    'components:extend'(components) {
      const aliasMap: Record<string, string> = {
        Statusbar: 'StatusBar',
        Windowsmanager: 'WindowsManager',
        Exitbutton: 'ExitButton',
        Fullscreenbutton: 'FullscreenButton',
        Timebutton: 'TimeButton',
        Settingsbutton: 'SettingsButton',
        Settingscontent: 'SettingsContent',
        Cablebutton: 'CableButton',
        Devicescontent: 'DevicesContent',
        Tablebutton: 'TableButton',
        Presetscontent: 'PresetsContent',
        Notesbutton: 'NotesButton',
        Eventscontent: 'EventsContent',
        Welcomecontent: 'WelcomeContent'
      }
      for (const comp of [...components]) {
        const alias = aliasMap[comp.pascalName]
        if (alias) {
          components.push({
            ...comp,
            pascalName: alias
          })
        }
      }
    }
  }
})
