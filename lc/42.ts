// 给定 n 个非负整数表示每个宽度为 1 的柱子的高度图，计算按此排列的柱子，下雨之后能接多少雨水。
// [0,1,0,2,1,0,1,3,2,1,2,1]
function trap(height: number[]): number {
    if (height.length < 3) {
        return 0
    }

    const leftMax: number[] = new Array(height.length).fill(0)
    const rightMax: number[] = new Array(height.length).fill(0)
    let sum = 0

    for (let i = 1; i < height.length; i++) {
        leftMax[i] = Math.max(leftMax[i - 1], height[i - 1])
    }

    for (let i = height.length - 2; i >= 0; i--) {
        rightMax[i] = Math.max(rightMax[i + 1], height[i + 1])
    }

    for (let i = 0; i < height.length; i++) {
        const waterHeight = Math.min(leftMax[i], rightMax[i])
        sum += Math.max(waterHeight - height[i], 0)
    }

    return sum
};

console.log(trap([0,1,0,2,1,0,1,3,2,1,2,1]));
