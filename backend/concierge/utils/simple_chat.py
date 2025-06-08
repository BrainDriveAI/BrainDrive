from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

model_name = "./kaggle/working/merged_qwen3-1.7B"
model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=torch.float16).cuda()
tokenizer = AutoTokenizer.from_pretrained(model_name)

# print(f"chat template: {tokenizer.chat_template}")

prompt = "System: You are the BrainDrive Concierge.\nUser: What kind of creative freedom does BrainDrive offer?"
inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
outputs = model.generate(
    **inputs,
    max_new_tokens=100,
    eos_token_id=tokenizer.encode("User:", add_special_tokens=False)[0]  # Stop at "User:" token
)
print(tokenizer.decode(outputs[0], skip_special_tokens=True))