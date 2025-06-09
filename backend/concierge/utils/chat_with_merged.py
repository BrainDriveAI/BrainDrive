import logging
from logging.handlers import RotatingFileHandler
import os
import re
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import warnings
from datetime import datetime

# Suppress specific warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning, module="torch")

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)
os.makedirs('logs', exist_ok=True)
file_handler = RotatingFileHandler('logs/chat_qwen3_1.7B.log', maxBytes=10*1024*1024, backupCount=5)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

def timestamped_print(message):
    """Print message with timestamp in the same format as logger."""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]
    print(f"{timestamp} - INFO - {message}")

def load_model(model_path="./kaggle/working/merged_qwen3-0.6B"):
    """Load the fine-tuned or merged model and tokenizer."""
    logger.info(f"Loading model from {model_path}")
    try:
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            torch_dtype=torch.float16,
            device_map="auto",
            trust_remote_code=True
        )
        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        model.eval()
        logger.info("Model loaded successfully")
        return model, tokenizer
    except Exception as e:
        logger.error(f"Failed to load model: {str(e)}")
        raise

def clean_response(response_ids, input_ids, tokenizer):
    """Clean the response by extracting generated tokens and removing artifacts."""
    generated_ids = response_ids[len(input_ids):]
    response = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
    # timestamped_print(f"Raw Assistant: {response}")
    
    # Remove 'assistant' prefix, think tags, and clean up whitespace
    response = re.sub(r'^assistant\s*', '', response, flags=re.IGNORECASE)
    response = re.sub(r'<think>.*?</think>\s*', '', response, flags=re.DOTALL)
    response = re.sub(r'<think>.*$', '', response, flags=re.DOTALL)  # Handle unclosed think tags
    response = re.sub(r'\s+', ' ', response).strip()
    
    return response

def chat_loop(model, tokenizer):
    """Run an interactive chat loop with the model."""
    # logger.info(f"Starting chat with {model}. Type 'exit' to quit.")
    timestamped_print("Starting chat with BrainDrive Concierge model. Type 'exit' to quit.")
    conversation = [{"role": "system", "content": "You are BrainDrive Concierge, a helpful assistant for the open-source project, BrainDrive.AI."}]

    while True:
        user_input = input(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]} - INFO - You: ")
        timestamped_print("Sent to model...")
        if user_input.lower() == 'exit':
            timestamped_print("Goodbye!")
            logger.info("Chat session ended")
            break

        conversation.append({"role": "user", "content": user_input})
        prompt = tokenizer.apply_chat_template(conversation, tokenize=False)
        logger.debug(f"Prompt: {prompt}")
        
        try:
            inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
            input_ids = inputs.input_ids

            with torch.no_grad():
                outputs = model.generate(
                    input_ids,
                    max_new_tokens=512,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.8,
                    top_k=20,
                    eos_token_id=tokenizer.eos_token_id,
                    pad_token_id=tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id
                )
            logger.debug(f"Raw output IDs: {outputs[0].tolist()}")
            cleaned_response = clean_response(outputs[0], input_ids[0], tokenizer)
            timestamped_print(f"LLM: {cleaned_response}")
            conversation.append({"role": "assistant", "content": cleaned_response})
            
        except Exception as e:
            logger.error(f"Error during generation: {str(e)}")
            timestamped_print(f"Error: Failed to generate response. Please try again.")
            continue

if __name__ == "__main__":
    model_path = "./kaggle/working/merged_qwen3-1.7B"
    try:
        model, tokenizer = load_model(model_path)
        chat_loop(model, tokenizer)
    except Exception as e:
        logger.error(f"Application failed: {str(e)}")
        timestamped_print(f"Application error: {str(e)}")