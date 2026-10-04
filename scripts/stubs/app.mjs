// Nuxt 自动导入的最小桩，仅供 node 下直接测试 store 使用
export { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'

import { computed as vueComputed, ref as vueRef, watch as vueWatch, onMounted as vueOnMounted, onBeforeUnmount as vueOnBeforeUnmount } from 'vue'

globalThis.ref = vueRef
globalThis.computed = vueComputed
globalThis.watch = vueWatch
globalThis.onMounted = vueOnMounted
globalThis.onBeforeUnmount = vueOnBeforeUnmount
globalThis.defineNuxtConfig = (config) => config

export const useNuxtApp = () => ({})
export default {}
