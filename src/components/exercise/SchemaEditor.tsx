'use client'

import { Editor, type EditorProps } from './Editor'

export function SchemaEditor(props: Omit<EditorProps, 'language'>) {
  return <Editor {...props} language="sql" label={props.label ?? 'Schema editor'} />
}
