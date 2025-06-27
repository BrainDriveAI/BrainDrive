import pdfplumber
import re
import logging
import os
import json
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
file_handler = RotatingFileHandler('logs/script.log', maxBytes=10*1024*1024, backupCount=5)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

# Suppress pdfplumber warnings
logging.getLogger("pdfplumber").setLevel(logging.ERROR)

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

def extract_pdf_text(pdf_file):
    """Extract text from all pages of a PDF file."""
    logger.info(f"Extracting text from PDF: {pdf_file}")
    try:
        with pdfplumber.open(pdf_file) as pdf:
            text = []
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text.append(page_text.strip())
            extracted_text = '\n\n'.join(text)
            print(f"\n{extracted_text}\n")
            logger.info(f"Successfully extracted {len(extracted_text)} characters from {pdf_file}")
            return extracted_text
    except FileNotFoundError:
        logger.error(f"PDF file '{pdf_file}' not found")
        raise
    except Exception as e:
        logger.error(f"Error extracting text from {pdf_file}: {str(e)}")
        raise ValueError(f"Error extracting text from PDF: {str(e)}")

def convert_to_markdown(text):
    """Note this doesn't work all that well and is skipped. Convert plain text to Markdown format with generic formatting."""
    logger.info("Converting extracted text to Markdown")
    lines = text.split('\n')
    markdown = []
    in_list = False

    for line in lines:
        line = line.strip()
        if not line:
            markdown.append('')
            continue

        # Detect bullet points (e.g., -, *, ●, numbered lists like 1.)
        if re.match(r'^[-*●] |^\d+\.\s', line):
            if not in_list:
                in_list = True
                markdown.append('')  # Add space before list
            markdown.append(line)  # Preserve bullet as-is
            logger.debug(f"Detected bullet point: {line}")
        else:
            # End list if exiting bullet points
            if in_list:
                in_list = False
                markdown.append('')

            # Detect headers (uppercase or short lines, typically < 50 chars)
            if line.isupper() or (len(line) < 50 and line.strip().endswith(':')):
                markdown.append(f"## {line}")
                logger.debug(f"Detected header: {line}")
            else:
                # Default to plain text
                markdown.append(line)
                logger.debug(f"Processed as plain text: {line}")

    # Join lines, collapse multiple blank lines
    markdown_text = '\n'.join(line for line in markdown if line or markdown[max(0, markdown.index(line) - 1)])
    logger.info(f"Generated Markdown with {len(markdown_text.splitlines())} lines")
    return markdown_text

def read_existing_questions(output_jsonl):
    """Read existing questions from the JSONL file."""
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

def generate_qa_pairs_ollama(pdf_content, model="gemma3:4b", num_pairs=5):
    """Generate Q&A pairs using Ollama LLM in ChatML JSONL format."""
    logger.info(f"Generating {num_pairs} Q&A pairs using Ollama model {model}")
    prompt = (
        "You are a dataset creation assistant. Generate exactly {num_pairs} Q&A pairs in ChatML JSONL format based on the provided documentation. "
        "Each pair should include a system message ('You are a helpful assistant.'), a user question, and an assistant response. "
        "Focus on key concepts in the documentation. Ensure questions are concise and answers are accurate. Return only the JSONL lines.\n\n"
        "Documentation:\n```md\n{pdf_content}\n```"
    ).format(num_pairs=num_pairs, pdf_content=pdf_content)

    logger.info(f"Sending request to Ollama with prompt length: {len(prompt)} characters")
    try:
        response = ollama.chat(
            model=model,
            messages=[
                {"role": "system", "content": "You are a dataset creation assistant."},
                {"role": "user", "content": prompt}
            ]
        )
        logger.info(f"Received Ollama response (length: {len(response['message']['content'])} chars, preview: {response['message']['content'][:100].strip()})")
        
        # Strip ```json and ``` delimiters if present
        qa_text = response['message']['content'].strip()
        logger.info("Processing response: stripping delimiters")
        if qa_text.startswith('```json'):
            qa_text = qa_text[len('```json'):].strip()
            logger.info("Stripped ```json delimiter")
        if qa_text.endswith('```'):
            qa_text = qa_text[:-len('```')].strip()
            logger.info("Stripped ``` delimiter")
        qa_lines = qa_text.split('\n')
        logger.info(f"Split response into {len(qa_lines)} lines")

        # Validate each line is valid JSON
        valid_qa_lines = []
        for line in qa_lines:
            try:
                json.loads(line)
                valid_qa_lines.append(line)
            except json.JSONDecodeError:
                logger.warning(f"Skipping invalid JSON line: {line}")
        logger.info(f"Generated {len(valid_qa_lines)} valid Q&A pairs")
        return valid_qa_lines
    except Exception as e:
        logger.error(f"Error generating Q&A pairs with Ollama: {str(e)}")
        raise ValueError(f"Error generating Q&A pairs: {str(e)}")

def generate_qa_pairs_grok(pdf_content, client, output_jsonl, model="grok-3-fast-beta", num_pairs=5):
    """Generate Q&A pairs using Grok API in ChatML JSONL format, ensuring uniqueness."""
    logger.info(f"Generating {num_pairs} Q&A pairs using Grok model {model}")
    
    # Read existing questions to avoid duplicates
    existing_questions = read_existing_questions(output_jsonl)
    existing_questions_text = "\n".join([f"- {q}" for q in existing_questions]) if existing_questions else "None"

    prompt = (
        f"You are a dataset creation assistant. Generate exactly {num_pairs} Q&A pairs in ChatML JSONL format based on the provided documentation. "
        "Each pair must include a system message ('You are a helpful assistant.'), a user question, and an assistant response. "
        "Focus on key concepts in the documentation. Ensure questions are concise, accurate, and **unique**—do not repeat any questions listed below. "
        "Return only the JSONL lines.\n\n"
        f"Existing questions to avoid:\n{existing_questions_text}\n\n"
        f"Documentation:\n{pdf_content}"
    )

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
        logger.info("Processing response: stripping delimiters")
        if qa_text.startswith('```json'):
            qa_text = qa_text[len('```json'):].strip()
            logger.info("Stripped ```json delimiter")
        if qa_text.endswith('```'):
            qa_text = qa_text[:-len('```')].strip()
            logger.info("Stripped ``` delimiter")
        qa_lines = qa_text.split('\n')
        logger.info(f"Split response into {len(qa_lines)} lines")

        # Validate each line is valid JSON
        valid_qa_lines = []
        for line in qa_lines:
            try:
                json.loads(line)
                valid_qa_lines.append(line)
            except json.JSONDecodeError:
                logger.warning(f"Skipping invalid JSON line: {line}")
        logger.info(f"Generated {len(valid_qa_lines)} valid Q&A pairs")
        return valid_qa_lines
    except Exception as e:
        logger.error(f"Error generating Q&A pairs with Grok API: {str(e)}")
        raise ValueError(f"Error generating Q&A pairs: {str(e)}")

def append_to_jsonl(qa_pairs, output_file):
    """Append Q&A pairs to a JSONL file."""
    logger.info(f"Appending {len(qa_pairs)} Q&A pairs to {output_file}")
    try:
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        with open(output_file, 'a', encoding='utf-8') as f:
            for pair in qa_pairs:
                f.write(pair + '\n')
        logger.info(f"Successfully appended to {output_file}")
    except Exception as e:
        logger.error(f"Error writing to {output_file}: {str(e)}")
        raise ValueError(f"Error writing to JSONL file: {str(e)}")

def pdf_to_markdown(input_path, output_jsonl="data/test.jsonl", model_type="ollama", ollama_model="gemma3:4b", grok_model="grok-3-fast-beta"):
    """Process a single PDF or a folder of PDFs and generate Q&A pairs."""
    logger.info(f"Processing input: {input_path} with model_type: {model_type}")
    pdf_files = []
    
    if os.path.isfile(input_path) and input_path.lower().endswith('.pdf'):
        pdf_files.append(input_path)
    elif os.path.isdir(input_path):
        pdf_files = [os.path.join(input_path, f) for f in os.listdir(input_path) if f.lower().endswith('.pdf')]
        logger.info(f"Found {len(pdf_files)} PDF files in directory {input_path}")
    else:
        logger.error(f"Input path '{input_path}' is neither a PDF file nor a directory")
        raise ValueError("Input must be a PDF file or a directory containing PDFs")

    # Initialize Grok client if needed
    grok_client = None
    if model_type == "grok":
        grok_client = setup_grok_client()

    for pdf_file in pdf_files:
        logger.info(f"Processing PDF: {pdf_file}")
        try:
            text_content = extract_pdf_text(pdf_file)
            # markdown_content = convert_to_markdown(text_content)
            # logger.info(f"markdown_content: {markdown_content}")
            if model_type == "ollama":
                qa_pairs = generate_qa_pairs_ollama(text_content, model=ollama_model)
            else:  # model_type == "grok"
                qa_pairs = generate_qa_pairs_grok(text_content, grok_client, output_jsonl, model=grok_model, num_pairs=5)
            append_to_jsonl(qa_pairs, output_jsonl)
        except Exception as e:
            logger.error(f"Failed to process {pdf_file}: {str(e)}")
            continue

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Convert PDFs to Q&A pairs in JSONL format")
    parser.add_argument("input_path", help="Path to a PDF file or directory containing PDFs")
    parser.add_argument("--model", choices=["ollama", "grok"], default="ollama", help="Model to use for Q&A generation (default: ollama)")
    args = parser.parse_args()
    
    pdf_to_markdown(args.input_path, model_type=args.model)