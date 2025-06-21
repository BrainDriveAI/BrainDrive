import json
import re
import logging
import os
from datetime import datetime
from bs4 import BeautifulSoup
import unicodedata
import ollama
import argparse
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from logging.handlers import RotatingFileHandler

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

# Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# File handler with rotation
os.makedirs('logs', exist_ok=True)
file_handler = RotatingFileHandler('logs/generate_qa.log', maxBytes=10*1024*1024, backupCount=5)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

# Load environment variables
load_dotenv()
XAI_API_KEY = os.getenv("XAI_API_KEY")

def setup_grok_client():
    """Initialize the Grok API client."""
    logger.info("Setting up Grok API client")
    if not XAI_API_KEY:
        logger.error("XAI_API_KEY not found in .env file")
        raise ValueError("XAI_API_KEY is required for Grok API")
    return OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")

def clean_text(html_content):
    """Clean HTML content by removing tags, normalizing Unicode, and removing noise."""
    logger.info("Cleaning HTML content")
    try:
        # Remove HTML tags
        soup = BeautifulSoup(html_content, "html.parser")
        text = soup.get_text(separator=" ")
        
        # Normalize Unicode characters
        text = unicodedata.normalize("NFKD", text)
        
        # Remove emoji URLs
        text = re.sub(r"https://community\.braindrive\.ai/images/emoji/[^ ]+", "", text)
        
        # Clean up extra whitespace and newlines
        text = re.sub(r"\s+", " ", text).strip()
        
        logger.info(f"Cleaned text length: {len(text)} characters")
        print(f"\n{text}\n")
        return text
    except Exception as e:
        logger.error(f"Error cleaning text: {str(e)}")
        return ""

def read_existing_questions(output_jsonl):
    """Read existing questions from the JSONL file to avoid duplicates."""
    existing_questions = []
    if os.path.exists(output_jsonl):
        logger.info(f"Reading existing questions from {output_jsonl}")
        try:
            with open(output_jsonl, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        data = json.loads(line.strip())
                        for message in data.get('messages', []):
                            if message.get('role') == 'user':
                                existing_questions.append(message.get('content'))
                    except json.JSONDecodeError:
                        logger.warning(f"Skipping invalid JSON line in {output_jsonl}: {line.strip()}")
            logger.info(f"Found {len(existing_questions)} existing questions")
        except Exception as e:
            logger.error(f"Error reading {output_jsonl}: {str(e)}")
    else:
        logger.info(f"No existing {output_jsonl} file found")
    return existing_questions

def generate_qa_pairs_ollama(topic_content, topic_title, category_name, num_pairs=5, model="llama3"):
    """Generate Q&A pairs using Ollama LLM in ChatML JSONL format."""
    logger.info(f"Generating {num_pairs} Q&A pairs for topic '{topic_title}' using Ollama model {model}")
    prompt = (
        "You are a dataset creation assistant. Generate exactly {num_pairs} Q&A pairs in ChatML JSONL format based on the provided BrainDrive forum topic. "
        "Each pair must include a system message ('You are a helpful assistant.'), a concise user question, and an accurate assistant response. "
        "Focus on key concepts in the topic content, title, and category ('{category_name}'). "
        "Questions should be unique, relevant to the topic, and avoid repetition. "
        "Return only the JSONL lines.\n\n"
        "Topic Title: {topic_title}\n"
        "Category: {category_name}\n"
        "Content:\n```text\n{topic_content}\n```"
    ).format(num_pairs=num_pairs, topic_title=topic_title, category_name=category_name, topic_content=topic_content)

    logger.info(f"Sending request to Ollama with prompt length: {len(prompt)} characters")
    try:
        response = ollama.chat(
            model=model,
            messages=[
                {"role": "system", "content": "You are a dataset creation assistant."},
                {"role": "user", "content": prompt}
            ]
        )
        qa_text = response['message']['content'].strip()
        logger.info(f"Received Ollama response (length: {len(qa_text)} chars, preview: {qa_text[:100].strip()})")
        
        # Strip ```json and ``` delimiters if present
        if qa_text.startswith('```json'):
            qa_text = qa_text[len('```json'):].strip()
        if qa_text.endswith('```'):
            qa_text = qa_text[:-len('```')].strip()
        qa_lines = qa_text.split('\n')

        # Validate JSON lines
        valid_qa_lines = []
        for line in qa_lines:
            try:
                json.loads(line)
                valid_qa_lines.append(line)
            except json.JSONDecodeError:
                logger.warning(f"Skipping invalid JSON line: {line}")
        logger.info(f"Generated {len(valid_qa_lines)} valid Q&A pairs for topic '{topic_title}'")
        return valid_qa_lines
    except Exception as e:
        logger.error(f"Error generating Q&A pairs with Ollama for topic '{topic_title}': {str(e)}")
        return []

def generate_qa_pairs_grok(topic_content, topic_title, category_name, client, output_jsonl, num_pairs=5, model="grok-3-fast-beta"):
    """Generate Q&A pairs using Grok API in ChatML JSONL format, ensuring uniqueness."""
    logger.info(f"Generating {num_pairs} Q&A pairs for topic '{topic_title}' using Grok model {model}")
    
    # Read existing questions to avoid duplicates
    existing_questions = read_existing_questions(output_jsonl)
    existing_questions_text = "\n".join([f"- {q}" for q in existing_questions]) if existing_questions else "None"

    prompt = (
        "You are a dataset creation assistant. Generate exactly {num_pairs} Q&A pairs in ChatML JSONL format based on the provided BrainDrive forum topic. "
        "Each pair must include a system message ('You are a helpful assistant.'), a concise user question, and an accurate assistant response. "
        "Focus on key concepts in the topic content, title, and category ('{category_name}'). "
        "Questions must be unique, relevant to the topic, and avoid repeating any questions listed below. "
        "Return only the JSONL lines.\n\n"
        "Existing questions to avoid:\n{existing_questions_text}\n\n"
        "Topic Title: {topic_title}\n"
        "Category: {category_name}\n"
        "Content:\n```text\n{topic_content}\n```"
    ).format(num_pairs=num_pairs, topic_title=topic_title, category_name=category_name, topic_content=topic_content, existing_questions_text=existing_questions_text)

    logger.info(f"Sending request to Grok API with prompt length: {len(prompt)} characters, {len(existing_questions)} existing questions")
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a dataset creation assistant"},
                {"role": "user", "content": prompt}
            ]
        )
        qa_text = completion.choices[0].message.content.strip()
        logger.info(f"Received Grok response (length: {len(qa_text)} chars, preview: {qa_text[:100].strip()})")
        
        # Strip ```json and ``` delimiters if present
        if qa_text.startswith('```json'):
            qa_text = qa_text[len('```json'):].strip()
        if qa_text.endswith('```'):
            qa_text = qa_text[:-len('```')].strip()
        qa_lines = qa_text.split('\n')

        # Validate JSON lines
        valid_qa_lines = []
        for line in qa_lines:
            try:
                json.loads(line)
                valid_qa_lines.append(line)
            except json.JSONDecodeError:
                logger.warning(f"Skipping invalid JSON line: {line}")
        logger.info(f"Generated {len(valid_qa_lines)} valid Q&A pairs for topic '{topic_title}'")
        return valid_qa_lines
    except Exception as e:
        logger.error(f"Error generating Q&A pairs with Grok API for topic '{topic_title}': {str(e)}")
        return []

def append_to_jsonl(qa_pairs, output_file):
    """Append Q&A pairs to a JSONL file."""
    logger.info(f"Appending {len(qa_pairs)} Q&A pairs to {output_file}")
    try:
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        with open(output_file, 'a', encoding='utf-8') as f:
            for pair in qa_pairs:
                f.write(pair + '\n')
        logger.info(f"Successfully appended to {output_file}")
    except Exception as e:
        logger.error(f"Error writing to {output_file}: {str(e)}")
        raise ValueError(f"Error writing to JSONL file: {str(e)}")

def process_forum_json(json_file, output_jsonl="data/braindrive_qa_dataset.jsonl", model_type="ollama", ollama_model="llama3", grok_model="grok-3-fast-beta"):
    """Process forum JSON and generate Q&A pairs for each topic."""
    logger.info(f"Processing JSON file: {json_file} with model_type: {model_type}")
    
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            forum_data = json.load(f)
        logger.info(f"Loaded JSON with {len(forum_data)} categories")
    except Exception as e:
        logger.error(f"Error reading {json_file}: {str(e)}")
        raise ValueError(f"Error reading JSON file: {str(e)}")

    # Initialize Grok client if needed
    grok_client = None
    if model_type == "grok":
        grok_client = setup_grok_client()

    total_topics = sum(len(category['topics']) for category in forum_data)
    logger.info(f"Found {total_topics} topics across all categories")
    
    for category in forum_data:
        category_name = category['category_name']
        topics = category['topics']
        logger.info(f"Processing category '{category_name}' with {len(topics)} topics")
        
        for topic in topics:
            topic_title = topic['title']
            topic_content = topic['content']
            
            # Clean the content
            cleaned_content = clean_text(topic_content)
            if not cleaned_content:
                logger.warning(f"Skipping topic '{topic_title}' due to empty cleaned content")
                continue
            
            try:
                # Generate Q&A pairs
                if model_type == "ollama":
                    qa_pairs = generate_qa_pairs_ollama(
                        cleaned_content,
                        topic_title,
                        category_name,
                        model=ollama_model,
                        num_pairs=5
                    )
                else:  # model_type == "grok"
                    qa_pairs = generate_qa_pairs_grok(
                        cleaned_content,
                        topic_title,
                        category_name,
                        grok_client,
                        output_jsonl,
                        model=grok_model,
                        num_pairs=5
                    )
                
                # Append to JSONL
                if qa_pairs:
                    append_to_jsonl(qa_pairs, output_jsonl)
                else:
                    logger.warning(f"No Q&A pairs generated for topic '{topic_title}'")
            except Exception as e:
                logger.error(f"Failed to process topic '{topic_title}': {str(e)}")
                continue

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Generate Q&A pairs from BrainDrive forum JSON")
    parser.add_argument("json_file", help="Path to the forum JSON file")
    parser.add_argument("--model", choices=["ollama", "grok"], default="ollama", help="Model to use for Q&A generation (default: ollama)")
    parser.add_argument("--ollama-model", default="llama3", help="Ollama model to use (default: llama3)")
    parser.add_argument("--grok-model", default="grok-3-fast-beta", help="Grok model to use (default: grok-3-fast-beta)")
    parser.add_argument("--output", default="data/braindrive_qa_dataset.jsonl", help="Output JSONL file (default: data/braindrive_qa_dataset.jsonl)")
    args = parser.parse_args()
    
    process_forum_json(
        args.json_file,
        output_jsonl=args.output,
        model_type=args.model,
        ollama_model=args.ollama_model,
        grok_model=args.grok_model
    )