public class ProPlan extends AIModel {
    private int teamSlots;

    public ProPlan(String modelName, double price, int parameters, int contextWindow, int teamSlots) {
        super(modelName, price, parameters, contextWindow);
        this.teamSlots = teamSlots;
    }

    public int getTeamSlots() {
        return teamSlots;
    }

    public String addTeamMember(String memberName) {
        if (teamSlots > 0) {
            teamSlots--;
            return memberName + " added. Slots remaining: " + teamSlots;
        }
        return "Error: No available team slots.";
    }

    public String removeTeamMember(String memberName) {
        teamSlots++;
        return memberName + " removed. Slots available: " + teamSlots;
    }

    public String enterPrompt(String promptText, int expectedOutputTokens) {
        try {
            int totalTokens = calculateTotalToken(promptText, expectedOutputTokens);

            return "Prompt: " + promptText +
                   "\nExpected output tokens: " + expectedOutputTokens +
                   "\nTotal tokens used: " + totalTokens +
                   "\nPro Plan token balance is not reduced.";
        } catch (IllegalArgumentException e) {
            return "Error: " + e.getMessage();
        }
    }

    @Override
    public String display() {
        return "AI Model: " + getModelName() +
               "\nSubscription Cost: Rs. " + getCost() + " per 1 Lakh tokens" +
               "\nModel Size: " + getParameters() + " billion params" +
               "\nContext Window: " + getContextWindow() +
               "\nTeam Slots Available: " + teamSlots;
    }
}
