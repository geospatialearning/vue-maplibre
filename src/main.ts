import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import Map from './components/Map.vue'

const app = createApp(Map)

app.use(createPinia())

app.mount('#app')
