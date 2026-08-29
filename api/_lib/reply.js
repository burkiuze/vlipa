/* What a model said, with the parts that were never meant for a reader taken
   out.

   Two kinds of thing turn up in front of an answer.

   Reasoning models narrate before they answer, inside <think>…</think>, and
   the narration is not the answer.

   And every model has its own private alphabet for calling a tool. DeepSeek
   writes <|DSML|tool_calls>, others write their own; the provider normally
   catches that and hands it back as a structured tool_calls list. When it does
   not — or when the model writes the markup out mid-sentence anyway — it lands
   in the chat looking like this:

     Selam! Let me read that file and walk through it.
     <|DSML|tool_calls>
     <|DSML|invoke name="list_files">
     <|DSML|parameter name="path" string="true">.</|DSML|parameter>

   Nobody should ever see that. It comes out here, closed or not: a block that
   ran into the token limit has no end tag, and half of one reads no better
   than all of it. */

/* A finished block, matched on its own opening tag so a reply that carries on
   afterwards keeps everything after it. */
const CLOSED = /<\|([a-z0-9_]{1,24})\|(tool_calls?|invoke|function_calls?)\b[\s\S]*?<\/\|\1\|\2>/gi;

/* One that was cut off. Everything from it to the end is markup. */
const DANGLING = /<\|[a-z0-9_]{1,24}\|(?:tool_calls?|invoke|function_calls?)\b[\s\S]*$/i;

/* Whatever single tokens are left: <|im_start|>, <|DSML|parameter …>,
   </|DSML|invoke>, <|eot_id|>. */
const TOKENS = /<\/?\|[a-z0-9_]{1,24}\|[^>]{0,400}>|<\/?\|[^|>]{0,60}\|>/gi;

export function cleanReply(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(CLOSED, '')
    .replace(DANGLING, '')
    .replace(TOKENS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
