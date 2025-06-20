## Old n8n Client Context Tool Code

This is the old code we had for the client context tool (it worked in n8n).

```json
{
  "nodes": [
    {
      "parameters": {
        "options": {}
      },
      "type": "@n8n/n8n-nodes-langchain.outputParserAutofixing",
      "typeVersion": 1,
      "position": [
        800,
        580
      ],
      "id": "8cd59633-9b86-415a-b7b9-d6f1475f3ea9",
      "name": "Auto-fixing Output Parser"
    },
    {
      "parameters": {
        "jsonSchemaExample": "{\n\t\"columns\": [\"context_email_analysis\", \"San context_email_trends\", \"context_calendar\", \"org_deep_research_data\"]\n}"
      },
      "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
      "typeVersion": 1.2,
      "position": [
        980,
        700
      ],
      "id": "e7a8381f-ae4d-49e4-88a0-f6f577a93e2e",
      "name": "Structured Output Parser"
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "0d599061-51a1-4f47-b182-e5767dceda97",
              "name": "query",
              "value": "={{ $('When Executed by Another Workflow').item.json.query || $('Manual Trigger').item.json.query || \"info about colleagues and project collaborators\" }}",
              "type": "string"
            },
            {
              "id": "f11db468-1441-48f2-a1f1-039170f7b685",
              "name": "user",
              "value": "={{ $('When Executed by Another Workflow').item.json.user || $('Manual Trigger').item.json.user }}",
              "type": "string"
            },
            {
              "id": "4c55ed5c-6292-4cc6-a006-2dac9f4ed667",
              "name": "user_message",
              "value": "={{ $('When Executed by Another Workflow').item.json.user_message || $('Manual Trigger').item.json.user_message }}",
              "type": "string"
            },
            {
              "id": "355131ec-9f16-4d44-8f78-6e1be5617337",
              "name": "columns",
              "value": "={{ \n  \"available columns:\\n\" + \n  $('Supabase - Table Schema').all()\n  .filter(item => item.json.column_name !== \"id\")\n  .filter(item => item.json.column_name !== \"created_at\")\n  .filter(item => item.json.column_name !== \"modified_at\")\n  .filter(item => item.json.column_name !== \"clerk_id\")\n  .filter(item => item.json.column_name !== \"google_refresh_token\")\n  .filter(item => item.json.column_name !== \"job_title\")\n  .filter(item => item.json.column_name !== \"email\")\n  .filter(item => !item.json.column_name.includes(\"name\"))\n  .map( item => \n  \"\\t\" + item.json.column_name + \": \" + item.json.data_type\n  )\n  .sort()\n  .join(\"\\n\")\n}}",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        440,
        360
      ],
      "id": "512de7f4-1088-493d-8b43-128670dabe87",
      "name": "Clean Fields",
      "executeOnce": true
    },
    {
      "parameters": {
        "workflowInputs": {
          "values": [
            {
              "name": "query"
            },
            {
              "name": "user"
            },
            {
              "name": "user_message"
            }
          ]
        }
      },
      "type": "n8n-nodes-base.executeWorkflowTrigger",
      "typeVersion": 1.1,
      "position": [
        -220,
        360
      ],
      "id": "bea8325f-554d-4fdd-87af-9a4b9e69af41",
      "name": "When Executed by Another Workflow"
    },
    {
      "parameters": {
        "model": {
          "__rl": true,
          "value": "gpt-4.1",
          "mode": "list",
          "cachedResultName": "gpt-4.1"
        },
        "options": {
          "responseFormat": "json_object",
          "maxRetries": 7
        }
      },
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1.2,
      "position": [
        660,
        580
      ],
      "id": "8c101f3b-4f77-46be-a1f9-3b32c8a63bfa",
      "name": "4.1 - 1",
      "credentials": {
        "openAiApi": {
          "id": "D5MR3tNxIQhu9U8B",
          "name": "OpenAi Project API Key"
        }
      }
    },
    {
      "parameters": {
        "model": {
          "__rl": true,
          "value": "gpt-4.1-mini",
          "mode": "list",
          "cachedResultName": "gpt-4.1-mini"
        },
        "options": {
          "responseFormat": "json_object",
          "maxRetries": 7
        }
      },
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1.2,
      "position": [
        800,
        700
      ],
      "id": "fb79d776-1a84-4a93-9ca7-f018b371292f",
      "name": "4.1 mini - 1",
      "credentials": {
        "openAiApi": {
          "id": "D5MR3tNxIQhu9U8B",
          "name": "OpenAi Project API Key"
        }
      }
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "00e02a19-820b-421c-9ee5-6f30ee5e0fe8",
              "name": "response",
              "value": "=<user_context>\n{{\n  Object.entries($('Supabase - Get User').item.json)\n    .filter(([key]) => $('Choose Columns').item.json.output.columns.includes(key))\n    .map(([k, v]) => {\n      // Check if v is an object (and not null) or an array\n      const valueString = (v !== null && typeof v === 'object') \n        ? JSON.stringify(v, null, 2) // Pretty-print objects/arrays\n        : String(v); // Convert anything else to a string\n      return `# ${k}:\\n\\n${valueString}`;\n    })\n    .join('\\n\\n---\\n\\n')\n    .slice(0, 1000000)\n}}\n</user_context>",
              "type": "string"
            },
            {
              "id": "8104a246-6e0d-472d-849f-6a0715bdf94e",
              "name": "response_tokens",
              "value": "={{\n  (\n  (Object.entries($('Supabase - Get User').item.json)\n    .filter(([key]) => $('Choose Columns').item.json.output.columns.includes(key))\n    .map(([k, v]) => {\n      // Check if v is an object (and not null) or an array\n      const valueString = (v !== null && typeof v === 'object') \n        ? JSON.stringify(v, null, 2) // Pretty-print objects/arrays\n        : String(v); // Convert anything else to a string\n      return `# ${k}:\\n\\n${valueString}`;\n    })\n    .join('\\n\\n---\\n\\n')\n  ).length() / 4.2 ).round(0)\n}}\n",
              "type": "number"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        1060,
        360
      ],
      "id": "faf01036-3850-46cb-a9ee-89a69ed53c53",
      "name": "Response"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User_Profiles';",
        "options": {}
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.6,
      "position": [
        220,
        360
      ],
      "id": "d8136b2e-478b-4f91-82dd-8922e78facf3",
      "name": "Supabase - Table Schema",
      "executeOnce": true,
      "credentials": {
        "postgres": {
          "id": "EF6ZPiGD7VnKgId9",
          "name": "Superchat"
        }
      }
    },
    {
      "parameters": {
        "promptType": "define",
        "text": "=<context>\nYou are an assistant in an AI chat application. The user has sent a message or request which may require additional context to answer or fulfill comprehensively.\n\nFor each user's client, we have several <User_Database_Columns> which are itemized below. These are often very lengthy, so we cannot include all (or even many) in every system prompt, since this would overload the context window for the LLM. \n\nYour role is to identify which columns are most directly or indirectly relevant to the query/message. You must return a JSON array of column names, which are listed below.\n\nThe <User_Database_Columns> below includes the column name and column type for every available column. There are no other columns.\n\nMost of these columns are generated from the client's SaaS account data. \n- For example, calendar, email, network, and drive context are analyses of multiple years of email threads, calendar events, and work artifacts (including collaborators or correspondents). \n- Similarly, the context for flights, hotels, personal and gift purchases, and so on are detailed (50k+ characters) reports from an AI on the client's past data.\n- Context_Daily includes information about all recent activity across all connected SaaS applications, typically the last 24h or 7d. \n- PDL is shorthand for People Data Labs, a B2B enrichment API service. It mostly has demographic and firmographic data about businesses and individuals, and is not very detailed.\n- Deep research refers to lengthy reports compiled by an AI assistant with complete web access, such as OpenAI's ChatGPT or Google Gemini using their latest research features. \n- \"Person\" refers to {{ $('Supabase - Get User').item.json.full_name }}, whose title is {{ $('Supabase - Get User').item.json.job_title }} at {{ $('Supabase - Get User').item.json.company_name }}.\n- \"Company\" refers to {{ $('Supabase - Get User').item.json.company_name }}, the client's primary company. The tool will typically have information about other companies if the client runs/collaborates with multiple at once or has a lengthy career history.\n- The user of this application human executive assistant to {{ $('Supabase - Get User').item.json.full_name }}, {{ $('Supabase - Get User').item.json.xp_full_name }} (or {{ $('Supabase - Get User').item.json.xp_full_name }}'s AI assistant). \n- Most of the other data should be self-explanatory. \n</context>\n\n<Guidelines>\n- Based on the below <User_Message> and <Search_Query>, please output the names of the columns from the <User_Database_Columns> which may include relevant information.\n- Err on the side of more rather than fewer columns.\n- You must always output at least one column name.\n- Output JSON according to the schema. \n</Guidelines>\n\n<Current_DateTime>\n{{ $now.toString() }}\n</Current_DateTime>\n\n<User_Database_Columns>\n{{ $json.columns }}\n</User_Database_Columns>\n\n<User_Message>\n{{ \n  $ifEmpty(\n    $json.user_message, \n    \"one-way flight next week to BKK from SFO in business class\"\n  ) \n}}\n</User_Message>\n\n<Search_Query>\n{{ $json.query }}\n</Search_Query>",
        "hasOutputParser": true
      },
      "type": "@n8n/n8n-nodes-langchain.chainLlm",
      "typeVersion": 1.5,
      "position": [
        660,
        360
      ],
      "id": "93eba732-639f-4a8f-8c03-3bda47623593",
      "name": "Choose Columns",
      "executeOnce": true
    },
    {
      "parameters": {
        "operation": "select",
        "schema": {
          "__rl": true,
          "value": "public",
          "mode": "list",
          "cachedResultName": "public"
        },
        "table": {
          "__rl": true,
          "value": "User_Profiles",
          "mode": "list",
          "cachedResultName": "User_Profiles"
        },
        "limit": 1,
        "where": {
          "values": [
            {
              "column": "email",
              "value": "={{ $json.user_email || \"c@chrisyork.co\" }}"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.6,
      "position": [
        0,
        360
      ],
      "id": "4ecfd470-e677-4295-ae7b-ef336ad691a1",
      "name": "Supabase - Get User",
      "credentials": {
        "postgres": {
          "id": "EF6ZPiGD7VnKgId9",
          "name": "Superchat"
        }
      }
    }
  ],
  "connections": {
    "Auto-fixing Output Parser": {
      "ai_outputParser": [
        [
          {
            "node": "Choose Columns",
            "type": "ai_outputParser",
            "index": 0
          }
        ]
      ]
    },
    "Structured Output Parser": {
      "ai_outputParser": [
        [
          {
            "node": "Auto-fixing Output Parser",
            "type": "ai_outputParser",
            "index": 0
          }
        ]
      ]
    },
    "Clean Fields": {
      "main": [
        [
          {
            "node": "Choose Columns",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "When Executed by Another Workflow": {
      "main": [
        [
          {
            "node": "Supabase - Get User",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "4.1 - 1": {
      "ai_languageModel": [
        [
          {
            "node": "Choose Columns",
            "type": "ai_languageModel",
            "index": 0
          }
        ]
      ]
    },
    "4.1 mini - 1": {
      "ai_languageModel": [
        [
          {
            "node": "Auto-fixing Output Parser",
            "type": "ai_languageModel",
            "index": 0
          }
        ]
      ]
    },
    "Supabase - Table Schema": {
      "main": [
        [
          {
            "node": "Clean Fields",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Choose Columns": {
      "main": [
        [
          {
            "node": "Response",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Supabase - Get User": {
      "main": [
        [
          {
            "node": "Supabase - Table Schema",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```