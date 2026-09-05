/**
 * 零依赖 JSX 运行时(经典工厂模式)。
 *
 * tsconfig 已配置 `"jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"`,
 * 任何 `.tsx` 文件里 `import { h, Fragment } from './jsx'` 后即可直接写 JSX,
 * 产出纯数据 vnode,不引入 React/Preact 依赖;未来做控制台 UI 或消息 DSL 时使用。
 */

/** JSX 元素类型:标签名为字符串,组件为函数。 */
export type ElementType = string | ((props: any) => VNodeChild)

/** 纯数据 vnode。 */
export interface VNode {
  type: ElementType
  props: Record<string, unknown> | null
  children: VNodeChild[]
}

export type VNodeChild = VNode | string | number | boolean | null | undefined | Iterable<VNodeChild>

/** 片段:无自身语义,仅聚合子节点。 */
export function Fragment(_props: null, ...children: VNodeChild[]): VNode {
  return { type: Fragment, props: null, children: flatten(children) }
}

/** JSX 经典工厂:`<div id="a">text</div>` → h('div', { id: 'a' }, 'text')。 */
export function h<P extends Record<string, unknown>>(
  type: ElementType,
  props?: P | null,
  ...children: VNodeChild[]
): VNode {
  return {
    type,
    props: props ? { ...props } : null,
    children: flatten(children),
  }
}

function flatten(children: VNodeChild[]): VNodeChild[] {
  const out: VNodeChild[] = []
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue
    if (typeof child === 'object' && Symbol.iterator in child && !('type' in child)) {
      out.push(...flatten([...(child as Iterable<VNodeChild>)]))
    } else {
      out.push(child)
    }
  }
  return out
}
