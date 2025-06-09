from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
import torch
import os

# Paths
base_model_name = "Qwen/Qwen3-1.7B"
lora_adapter_path = "kaggle/working/finetuned_qwen3-1.7B"
merged_model_path = "kaggle/working/merged_qwen3-1.7B"

# Load base model and tokenizer
print("Loading base model...")
base_model = AutoModelForCausalLM.from_pretrained(
    base_model_name,
    torch_dtype=torch.float16,
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(base_model_name)

# Load LoRA adapters
print("Loading LoRA adapters...")
model = PeftModel.from_pretrained(base_model, lora_adapter_path)

# Merge adapters with base model
print("Merging adapters...")
merged_model = model.merge_and_unload()

# Save merged model
print(f"Saving merged model to {merged_model_path}...")
os.makedirs(merged_model_path, exist_ok=True)
merged_model.save_pretrained(merged_model_path)
tokenizer.save_pretrained(merged_model_path)
print("Merged model saved.")