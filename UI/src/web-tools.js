// Web Tools for Ollama Web Search API
// These tools are exposed to the LLM when WebSearch Mode is enabled

const WEB_TOOLS = [
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the web for current information. Returns 5-10 results with titles, URLs, and snippets.\n\n🎯 INTELLIGENT SEARCH STRATEGY:\n1. Multiple targeted searches > One broad search\n   Example: \"Python 3.12 features\" + \"Python 3.12 release date\" > \"Python 3.12\"\n2. Use specific keywords: versions, dates, official, documentation, changelog\n3. Iterate: search → analyze → search again with refined query if needed\n4. Compare snippets across results before fetching\n\n⚠️ CONTEXT COSTS:\n- web_search (5 results): ~2K tokens\n- web_fetch (1 page): ~10K tokens\n- Rule: Answer from snippets if possible, fetch only when essential\n\n✅ USE WHEN:\n- Recent events, news, current data\n- Version numbers, release dates, latest updates\n- Multiple sources needed for verification\n- User explicitly requests search\n\n❌ DON'T USE:\n- General knowledge you're confident about\n- Code questions solvable without external docs\n- Current codebase/project questions\n\n💡 SMART WORKFLOW:\nSimple question → 1 search → answer from snippets\nComplex question → multiple searches → compare snippets → fetch 1-2 best URLs\nComparison → separate searches per topic → synthesize from snippets",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query string. Be specific and include relevant context. Examples: 'Ollama new engine 2025', 'Python 3.12 features', 'React 19 server components'"
                    },
                    max_results: {
                        type: "number",
                        description: "Maximum number of search results to return (default: 5, max: 10). Use 3 for targeted queries, 10 for broad research."
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_fetch",
            description: "Fetch full content from a URL. EXPENSIVE: ~10K-20K tokens per fetch!\n\n🎯 INTELLIGENT FETCH STRATEGY:\n1. ALWAYS search first, analyze snippets, THEN decide if fetch needed\n2. Fetch official/authoritative sources only (docs, github, official blogs)\n3. For comparisons: fetch max 1 URL per topic (e.g., React docs + Vue docs = 2 fetches max)\n4. Skip fetch if snippets answer the question sufficiently\n\n⚠️ COST AWARENESS:\n- 1 fetch = 5× search cost\n- Unnecessary fetch = wasted 10K tokens\n- Bad: fetch everything / Good: fetch selectively\n\n✅ FETCH WHEN:\n- User provides URL explicitly\n- Need complete API documentation\n- Snippet shows partial code, user needs full example\n- Technical details require authoritative source\n\n❌ DON'T FETCH:\n- When snippet already has the answer\n- Multiple URLs for same question\n- Speculatively \"to check\"\n- Non-authoritative sources\n\n💡 DECISION LOGIC:\nSnippet sufficient? → Answer, cite URL, NO fetch\nSnippet incomplete? → Fetch ONLY the most authoritative URL\nMultiple topics? → Max 1 fetch per topic\n\n🔥 BEST PRACTICE:\nSearch → Analyze ALL snippets → Choose 1 best URL → Fetch → Synthesize",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The URL to fetch. Must be a valid HTTP/HTTPS URL. Examples: 'https://ollama.com/blog/latest', 'https://docs.python.org/3/library/asyncio.html'"
                    }
                },
                required: ["url"]
            }
        }
    }
];

module.exports = { WEB_TOOLS };
