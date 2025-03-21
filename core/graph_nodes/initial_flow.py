import asyncio
import logging
from typing import Dict, Any
from datetime import datetime
from langchain_core.messages import HumanMessage

from models.models import SearchQuery, LearningPathState
from parsers.parsers import search_queries_parser, enhanced_modules_parser
from services.services import get_llm, get_search_tool
from langchain_core.prompts import ChatPromptTemplate

from core.graph_nodes.helpers import run_chain, batch_items, format_search_results, escape_curly_braces

async def execute_single_search(query: SearchQuery, key_provider = None) -> Dict[str, Any]:
    """
    Executes a single web search using the Perplexity LLM.
    
    Args:
        query: A SearchQuery instance with keywords and rationale.
        key_provider: Optional key provider for Perplexity search.
        
    Returns:
        A dictionary with the query, rationale, and search results.
    """
    try:
        # Properly await the async function
        search_model = await get_search_tool(key_provider=key_provider)
        logging.info(f"Searching for: {query.keywords}")
        
        # Create a prompt that asks for web search results
        search_prompt = f"{query.keywords}"
        
        # Invoke the Perplexity model with the search prompt as a string
        # ChatPerplexity returns an AIMessage directly, not an awaitable
        result = search_model.invoke(search_prompt)
        
        # Process the response into the expected format
        formatted_result = [
            {
                "source": f"Perplexity Search Result for '{query.keywords}'",
                "content": result.content
            }
        ]
        
        return {
            "query": query.keywords,
            "rationale": query.rationale,
            "results": formatted_result
        }
    except Exception as e:
        logging.error(f"Error searching for '{query.keywords}': {str(e)}")
        return {
            "query": query.keywords,
            "rationale": query.rationale,
            "results": [{"source": "Error", "content": f"Error performing search: {str(e)}"}]
        }

async def generate_search_queries(state: LearningPathState) -> Dict[str, Any]:
    """
    Generates optimal search queries for the user topic using an LLM chain.
    
    Args:
        state: The current LearningPathState with 'user_topic'.
        
    Returns:
        A dictionary containing the generated search queries and a list of execution steps.
    """
    logging.info(f"Generating search queries for topic: {state['user_topic']}")
    
    # Send progress update if callback is available
    progress_callback = state.get('progress_callback')
    if progress_callback:
        await progress_callback(f"Analyzing topic '{state['user_topic']}' to generate optimal search queries...")
    
    # Get language information from state
    output_language = state.get('language', 'en')
    search_language = state.get('search_language', 'en')
    
    prompt_text = """
# EXPERT TEACHING ASSISTANT INSTRUCTIONS

Your task is to analyze a learning topic and generate optimal search queries to gather comprehensive information.

## TOPIC ANALYSIS

Please analyze the topic "{user_topic}" thoroughly:

### CORE CONCEPT IDENTIFICATION
- Primary concepts that form the foundation
- Supporting concepts necessary for understanding
- Advanced concepts that build on the basics
- Practical applications and implications
- Tools, methodologies, or frameworks involved

### KNOWLEDGE STRUCTURE MAPPING
- Fundamental principles and theories
- Key relationships and dependencies
- Historical or contextual elements
- Current state and developments
- Future implications or trends

### COMPLEXITY LAYERS
- Basic principles and definitions
- Intermediate concepts and applications
- Advanced theories and implementations
- Expert-level considerations
- Cross-domain connections

## LANGUAGE INSTRUCTIONS
- Generate all of your analysis and responses in {output_language}.
- For search queries, use {search_language} to maximize the quality and quantity of information retrieved.

## SEARCH STRATEGY

Based on this analysis, generate 5 search queries that will:
1. Cover different critical aspects of the topic
2. Address various complexity levels
3. Explore diverse perspectives and applications
4. Ensure comprehensive understanding
5. Target high-quality educational content

For each search query:
- Make it specific and targeted
- Explain why this search is essential for understanding the topic
- Ensure it addresses a different aspect of the topic
- Design it to return high-quality educational content

Your response should be exactly 5 search queries, each with its detailed rationale.

{format_instructions}
"""
    prompt = ChatPromptTemplate.from_template(prompt_text)
    try:
        # Get Google key provider from state
        google_key_provider = state.get("google_key_provider")
        if not google_key_provider:
            logging.warning("Google key provider not found in state, this may cause errors")
        else:
            logging.debug("Found Google key provider in state, using for search query generation")
            
        result = await run_chain(prompt, lambda: get_llm(key_provider=google_key_provider), search_queries_parser, {
            "user_topic": state["user_topic"],
            "output_language": output_language,
            "search_language": search_language,
            "format_instructions": search_queries_parser.get_format_instructions()
        })
        search_queries = result.queries
        logging.info(f"Generated {len(search_queries)} search queries")
        
        # Send progress update about completion
        if progress_callback:
            await progress_callback(f"Generated {len(search_queries)} search queries for topic '{state['user_topic']}'")
        
        return {
            "search_queries": search_queries,
            "steps": [f"Generated {len(search_queries)} search queries for topic: {state['user_topic']}"]
        }
    except Exception as e:
        logging.error(f"Error generating search queries: {str(e)}")
        return {"search_queries": [], "steps": [f"Error: {str(e)}"]}

async def execute_web_searches(state: LearningPathState) -> Dict[str, Any]:
    """
    Execute web searches for each search query in parallel.
    """
    if not state.get("search_queries"):
        logging.info("No search queries to execute")
        return {
            "search_results": [],
            "steps": state.get("steps", []) + ["No search queries to execute"]
        }
    
    search_queries = state["search_queries"]
    
    # Get the Perplexity key provider from state
    pplx_key_provider = state.get("pplx_key_provider")
    if not pplx_key_provider:
        logging.warning("Perplexity key provider not found in state, this may cause errors")
    else:
        logging.debug("Found Perplexity key provider in state, using for web searches")
    
    # Set up parallel processing
    batch_size = min(len(search_queries), state.get("search_parallel_count", 3))
    logging.info(f"Executing web searches in parallel with batch size {batch_size}")
    
    # Send progress update if callback is available
    progress_callback = state.get('progress_callback')
    if progress_callback:
        await progress_callback(f"Executing {len(search_queries)} web searches to gather information...")
    
    all_results = []
    
    try:
        for i in range(0, len(search_queries), batch_size):
            batch = search_queries[i:i+batch_size]
            logging.info(f"Processing batch of {len(batch)} searches")
            
            # Create tasks for parallel execution
            tasks = [execute_single_search(query, key_provider=pplx_key_provider) for query in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results and handle any exceptions
            for j, result in enumerate(batch_results):
                if isinstance(result, Exception):
                    logging.error(f"Error executing search: {str(result)}")
                    # Add a placeholder for failed searches
                    all_results.append({
                        "query": batch[j].keywords,
                        "results": [{"source": "Error", "content": f"Error executing search: {str(result)}"}],
                        "error": str(result)
                    })
                else:
                    all_results.append(result)
        
        logging.info(f"Completed {len(all_results)} web searches")
        
        # Send progress update
        if progress_callback:
            await progress_callback(f"Completed all web searches, processing {len(all_results)} results")
        
        return {
            "search_results": all_results,
            "steps": state.get("steps", []) + [f"Executed {len(all_results)} web searches"]
        }
    except Exception as e:
        logging.exception(f"Error executing web searches: {str(e)}")
        return {
            "search_results": all_results,
            "steps": state.get("steps", []) + [f"Error executing web searches: {str(e)}"]
        }

async def create_learning_path(state: LearningPathState) -> Dict[str, Any]:
    """
    Create a structured learning path from search results.
    """
    if not state.get("search_results") or len(state["search_results"]) == 0:
        logging.info("No search results available")
        return {
            "modules": [],
            "final_learning_path": {
                "topic": state["user_topic"],
                "modules": []
            },
            "steps": state.get("steps", []) + ["No search results available"]
        }
    
    # Get the Google key provider from state
    google_key_provider = state.get("google_key_provider")
    if not google_key_provider:
        logging.warning("Google key provider not found in state, this may cause errors")
    else:
        logging.debug("Found Google key provider in state, using for learning path creation")
    
    # Get language information from state
    output_language = state.get('language', 'en')
    
    # Send progress update if callback is available
    progress_callback = state.get('progress_callback')
    if progress_callback:
        await progress_callback(f"Creating initial learning path structure for '{state['user_topic']}'...")
    
    try:
        # Procesar los resultados de búsqueda para generar módulos
        processed_results = []
        for result in state["search_results"]:
            # Escapar las llaves en la consulta
            query = escape_curly_braces(result.get("query", "Unknown query"))
            raw_results = result.get("results", [])
            # Comprobar que raw_results es una lista
            if not isinstance(raw_results, list):
                logging.warning(f"Search results for query '{query}' is not a list; skipping this result.")
                continue
            if not raw_results:
                continue
                
            relevant_info = []
            for item in raw_results[:3]:  # Limitar a los 3 mejores resultados por búsqueda
                # Escapar las llaves en la fuente y el contenido
                source = escape_curly_braces(item.get('source', 'Unknown'))
                content = escape_curly_braces(item.get('content', 'No content'))
                relevant_info.append(f"Source: {source}\n{content}")
            
            processed_results.append({
                "query": query,
                "relevant_information": "\n\n".join(relevant_info)
            })
        
        # Convertir los resultados procesados a texto para incluir en el prompt
        results_text = ""
        for i, result in enumerate(processed_results, 1):
            results_text += f"""
Search {i}: "{result['query']}"
{result['relevant_information']}
---
"""
        # Check if a specific number of modules was requested
        module_count_instruction = ""
        if state.get("desired_module_count"):
            module_count_instruction = f"\nIMPORTANT: Create EXACTLY {state['desired_module_count']} modules for this learning path. Not more, not less."
        else:
            module_count_instruction = "\nCreate a structured learning path with 3-7 modules."
        
        # Add language instruction
        language_instruction = f"\nIMPORTANT: Create all content in {output_language}. All titles, descriptions, and content must be written in {output_language}."
        
        # Escapar las llaves en el tema del usuario
        escaped_topic = escape_curly_braces(state["user_topic"])
        
        # Preparar el prompt con un placeholder para format_instructions
        prompt_text = f"""
You are an expert curriculum designer. Create a comprehensive learning path for the topic: {escaped_topic}.

Based on the following search results, organize the learning into logical modules:

{results_text}
{module_count_instruction}{language_instruction} For each module:
1. Give it a clear, descriptive title
2. Write a comprehensive overview (100-200 words)
3. Identify 3-5 key learning objectives
4. Explain why this module is important in the overall learning journey

Format your response as a structured curriculum. Each module should build on previous knowledge.

{{format_instructions}}
"""
        # Crear la plantilla de prompt
        prompt = ChatPromptTemplate.from_template(prompt_text)
        
        # Llamar a la cadena LLM proporcionando el valor para 'format_instructions'
        result = await run_chain(
            prompt,
            lambda: get_llm(key_provider=google_key_provider),
            enhanced_modules_parser,
            { "format_instructions": enhanced_modules_parser.get_format_instructions() }
        )
        modules = result.modules
        
        # If a specific number of modules was requested but not achieved, log a warning
        if state.get("desired_module_count") and len(modules) != state["desired_module_count"]:
            logging.warning(f"Requested {state['desired_module_count']} modules but got {len(modules)}")
            if len(modules) > state["desired_module_count"]:
                # Trim excess modules if we got too many
                modules = modules[:state["desired_module_count"]]
                logging.info(f"Trimmed modules to match requested count of {state['desired_module_count']}")
        
        # Crear la estructura final del learning path
        final_learning_path = {
            "topic": state["user_topic"],
            "modules": modules,
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "num_modules": len(modules)
            }
        }
        
        logging.info(f"Created learning path with {len(modules)} modules")
        
        # Send progress update with information about the created modules
        if progress_callback and 'modules' in final_learning_path:
            module_count = len(final_learning_path['modules'])
            await progress_callback(f"Created initial learning path with {module_count} modules")
        
        return {
            "modules": modules,
            "final_learning_path": final_learning_path,
            "steps": state.get("steps", []) + [f"Created learning path with {len(modules)} modules"]
        }
    except Exception as e:
        logging.exception(f"Error creating learning path: {str(e)}")
        return {
            "modules": [],
            "final_learning_path": {
                "topic": state["user_topic"],
                "modules": []
            },
            "steps": state.get("steps", []) + [f"Error creating learning path: {str(e)}"]
        }
